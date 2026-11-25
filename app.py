"""
Sturex — Minimalist E-Commerce Storefront & Owner Operations Dashboard
======================================================================
Tech stack:
  - Python Flask + SQLite (sqlite3 with parameterized queries)
  - Flask cookie sessions + werkzeug.security password hashing
  - Built-in CSRF protection, login rate limiting, and CSV exports

Run locally:
  pip install -r requirements.txt
  python seed.py
  python app.py
"""

import csv
import io
import os
import re
import secrets
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from functools import wraps

from dotenv import load_dotenv
from flask import (
    Flask,
    Response,
    abort,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

from seed import create_tables

load_dotenv()

# ---------------------------------------------------------------------------
# App Configuration & Security Defaults
# ---------------------------------------------------------------------------
app = Flask(__name__, template_folder="templates", static_folder="static")

# Secret key loaded from environment variable with secure random fallback
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # 2 MB upload cap

DB_PATH = os.environ.get("DATABASE_PATH", "sturex.db")
UPLOAD_DIR = os.path.abspath(os.path.join(app.root_path, "static", "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
VALID_ORDER_STATUSES = ["Pending", "Paid", "Processing", "Shipped", "Delivered", "Cancelled"]

# Sliding-window IP rate limiter for login attempts (5 failures / 15 minutes)
LOGIN_WINDOW_SECONDS = 15 * 60
MAX_LOGIN_ATTEMPTS = 5
_login_failures: dict[str, list[float]] = {}


# ---------------------------------------------------------------------------
# Database Helpers
# ---------------------------------------------------------------------------
def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


with app.app_context():
    conn = sqlite3.connect(DB_PATH)
    create_tables(conn)
    conn.close()


def get_setting(key: str, fallback: str = "") -> str:
    row = get_db().execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else fallback


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower().strip()).strip("-")
    return slug or "object"


def csv_safe(val) -> str:
    """Prevent spreadsheet formula injection in exported CSV files."""
    s = str("" if val is None else val)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{s}"
    return s


# ---------------------------------------------------------------------------
# CSRF, Auth & Rate Limiting Helpers
# ---------------------------------------------------------------------------
def get_csrf_token() -> str:
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_hex(24)
    return session["csrf_token"]


@app.context_processor
def inject_globals():
    return {"csrf_token": get_csrf_token()}


def verify_csrf():
    expected = session.get("csrf_token", "")
    provided = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token", "")
    if not expected or not secrets.compare_digest(expected, provided):
        abort(403, description="Invalid or missing CSRF token.")


def owner_required(view):
    """Protect admin HTML and JSON endpoints so only the signed-in owner can access them."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("owner_id"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Authentication required"}), 401
            return redirect(url_for("admin_login"))
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            verify_csrf()
        return view(*args, **kwargs)

    return wrapped


def is_rate_limited(ip: str) -> tuple[bool, int]:
    now = time.time()
    recent = [t for t in _login_failures.get(ip, []) if now - t < LOGIN_WINDOW_SECONDS]
    _login_failures[ip] = recent
    if len(recent) >= MAX_LOGIN_ATTEMPTS:
        retry = int(LOGIN_WINDOW_SECONDS - (now - recent[0]))
        return True, max(1, retry)
    return False, 0


# ---------------------------------------------------------------------------
# Serve Generated Studio Images
# ---------------------------------------------------------------------------
@app.route("/src/assets/images/<path:filename>")
def serve_generated_images(filename: str):
    img_dir = os.path.abspath(os.path.join(app.root_path, "src", "assets", "images"))
    return send_from_directory(img_dir, filename)


# ---------------------------------------------------------------------------
# Public Storefront Pages & JSON API
# ---------------------------------------------------------------------------
@app.route("/")
def storefront_home():
    return render_template("storefront.html")


@app.route("/product/<slug>")
def product_detail_page(slug: str):
    product = get_db().execute(
        """
        SELECT p.*, c.name AS category_name, c.slug AS category_slug
        FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE p.slug = ?
        """,
        (slug,),
    ).fetchone()
    if not product:
        abort(404)
    return render_template("product_detail.html", product=dict(product))


@app.route("/api/categories")
def api_categories():
    rows = get_db().execute(
        """
        SELECT c.id, c.name, c.slug, c.description, COUNT(p.id) AS product_count
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.id
        GROUP BY c.id
        ORDER BY c.name ASC
        """
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/products")
def api_products():
    q = (request.args.get("q") or "").strip()
    category = (request.args.get("category") or "").strip()
    sort = request.args.get("sort") or "featured"

    clauses = []
    params = []
    if q:
        clauses.append("(p.name LIKE ? OR p.description LIKE ? OR p.sku LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
    if category and category != "all":
        clauses.append("c.slug = ?")
        params.append(category)

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    order_sql = "ORDER BY p.featured DESC, p.id ASC"
    if sort == "price_asc":
        order_sql = "ORDER BY p.price ASC"
    elif sort == "price_desc":
        order_sql = "ORDER BY p.price DESC"

    rows = get_db().execute(
        f"""
        SELECT p.id, p.sku, p.name, p.slug, p.description, p.category_id,
               c.name AS category_name, c.slug AS category_slug,
               p.price, p.stock, p.image_url, p.featured, p.created_at
        FROM products p
        JOIN categories c ON c.id = p.category_id
        {where_sql}
        {order_sql}
        """,
        params,
    ).fetchall()
    return jsonify([dict(r) for r in rows])


def create_payment_intent(method: str, order_number: str, amount: float) -> dict:
    """
    Payment adapter structured for Paystack or Flutterwave integration.
    Currently handles Pay on Delivery and Bank Transfer instructions.
    """
    ref = f"STX-{order_number.replace('STX-', '')}-{secrets.token_hex(3).upper()}"
    bank_info = get_setting("bank_account_info", "Sturex Studio LLC · Routing 021000021 · Acct 8841-9024-11")
    if method == "bank_transfer":
        return {
            "gateway": "bank_transfer",
            "reference": ref,
            "instructions": f"Transfer ${amount:.2f} to {bank_info}. Include {order_number} as your memo.",
            "authorizationUrl": None,
        }
    return {
        "gateway": "pay_on_delivery",
        "reference": ref,
        "instructions": f"Pay ${amount:.2f} via cash or contactless terminal upon courier delivery.",
        "authorizationUrl": None,
    }


@app.route("/api/orders", methods=["POST"])
def api_create_order():
    data = request.get_json(silent=True) or {}
    name = (data.get("customer_name") or "").strip()
    email = (data.get("customer_email") or "").strip().lower()
    phone = (data.get("customer_phone") or "").strip()
    address = (data.get("shipping_address") or "").strip()
    method = "bank_transfer" if data.get("payment_method") == "bank_transfer" else "pay_on_delivery"
    items = data.get("items") or []

    if len(name) < 2:
        return jsonify({"error": "Please enter your full name."}), 400
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        return jsonify({"error": "Please enter a valid email address."}), 400
    if len(phone) < 6:
        return jsonify({"error": "Please enter a valid phone number."}), 400
    if len(address) < 6:
        return jsonify({"error": "Please enter a complete delivery address."}), 400
    if not isinstance(items, list) or len(items) == 0:
        return jsonify({"error": "Your cart is empty."}), 400

    db = get_db()
    try:
        resolved = []
        subtotal = 0.0
        for raw in items:
            pid = int(raw.get("product_id", 0))
            qty = int(raw.get("quantity", 0))
            if pid < 1 or qty < 1 or qty > 50:
                raise ValueError("Invalid item quantity.")
            product = db.execute(
                "SELECT id, name, price, cost_price, stock FROM products WHERE id = ?",
                (pid,),
            ).fetchone()
            if not product:
                raise ValueError("Product no longer exists.")
            if product["stock"] < qty:
                raise ValueError(f"Only {product['stock']} left in stock for {product['name']}.")
            db.execute("UPDATE products SET stock = stock - ? WHERE id = ?", (qty, pid))
            subtotal += product["price"] * qty
            resolved.append(
                {
                    "product_id": product["id"],
                    "product_name": product["name"],
                    "unit_price": product["price"],
                    "unit_cost": product["cost_price"],
                    "quantity": qty,
                }
            )

        subtotal = round(subtotal, 2)
        shipping_fee = 0.0 if subtotal >= 150 else 12.0
        total = round(subtotal + shipping_fee, 2)
        max_id = db.execute("SELECT COALESCE(MAX(id), 0) FROM orders").fetchone()[0]
        order_number = f"STX-{1040 + max_id + 1}"
        payment = create_payment_intent(method, order_number, total)
        now = datetime.now(timezone.utc).isoformat()

        cur = db.execute(
            """
            INSERT INTO orders (
                order_number, customer_name, customer_email, customer_phone,
                shipping_address, payment_method, payment_reference, status,
                subtotal, shipping_fee, total, paid_recorded, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, 0, ?)
            """,
            (order_number, name, email, phone, address, method, payment["reference"],
             subtotal, shipping_fee, total, now),
        )
        order_id = cur.lastrowid
        for item in resolved:
            db.execute(
                """
                INSERT INTO order_items (order_id, product_id, product_name, unit_price, unit_cost, quantity)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (order_id, item["product_id"], item["product_name"],
                 item["unit_price"], item["unit_cost"], item["quantity"]),
            )
        db.commit()
        return jsonify({
            "id": order_id,
            "order_number": order_number,
            "status": "Pending",
            "subtotal": subtotal,
            "shipping_fee": shipping_fee,
            "total": total,
            "payment_method": method,
            "payment": payment,
            "items": resolved,
            "created_at": now,
        }), 201
    except (ValueError, TypeError) as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 400


@app.route("/api/orders/track")
def api_track_order():
    order_number = (request.args.get("order_number") or "").strip().upper()
    email = (request.args.get("email") or "").strip().lower()
    if not order_number or not email:
        return jsonify({"error": "Order number and customer email are required."}), 400

    order = get_db().execute(
        """
        SELECT id, order_number, customer_name, status, payment_method,
               payment_reference, subtotal, shipping_fee, total, created_at
        FROM orders
        WHERE UPPER(order_number) = ? AND LOWER(customer_email) = ?
        """,
        (order_number, email),
    ).fetchone()
    if not order:
        return jsonify({"error": "No matching order found."}), 404

    items = get_db().execute(
        "SELECT product_name, unit_price, quantity FROM order_items WHERE order_id = ?",
        (order["id"],),
    ).fetchall()
    result = dict(order)
    result["items"] = [dict(i) for i in items]
    return jsonify(result)


# ---------------------------------------------------------------------------
# Owner Authentication Routes (Single Owner Only, No Public Registration)
# ---------------------------------------------------------------------------
@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    db = get_db()
    owner_exists = db.execute("SELECT id FROM users LIMIT 1").fetchone() is not None

    if session.get("owner_id"):
        return redirect(url_for("admin_dashboard"))

    error = None
    if request.method == "POST":
        verify_csrf()
        ip = request.remote_addr or "unknown"
        limited, retry_sec = is_rate_limited(ip)
        if limited:
            error = f"Too many login attempts. Please wait {retry_sec} seconds."
        else:
            email = (request.form.get("email") or "").strip().lower()
            password = request.form.get("password") or ""
            name = (request.form.get("name") or "Studio Owner").strip()[:80]

            if not owner_exists:
                # First-run setup creates the single owner account
                if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email) or len(password) < 8:
                    error = "Valid email and password (minimum 8 characters) are required."
                else:
                    cur = db.execute(
                        "INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)",
                        (email, generate_password_hash(password), name, datetime.now(timezone.utc).isoformat()),
                    )
                    db.commit()
                    session["owner_id"] = cur.lastrowid
                    session["owner_email"] = email
                    return redirect(url_for("admin_dashboard"))
            else:
                user = db.execute(
                    "SELECT id, email, password_hash FROM users WHERE email = ?",
                    (email,),
                ).fetchone()
                if not user or not check_password_hash(user["password_hash"], password):
                    _login_failures.setdefault(ip, []).append(time.time())
                    error = "Invalid email or password."
                else:
                    _login_failures.pop(ip, None)
                    session["owner_id"] = user["id"]
                    session["owner_email"] = user["email"]
                    return redirect(url_for("admin_dashboard"))

    return render_template("admin_login.html", needs_setup=not owner_exists, error=error)


@app.route("/admin/logout", methods=["POST"])
def admin_logout():
    verify_csrf()
    session.clear()
    return redirect(url_for("admin_login"))


# ---------------------------------------------------------------------------
# Protected Owner Dashboard & JSON API (/admin & /api/admin/*)
# ---------------------------------------------------------------------------
@app.route("/admin")
@owner_required
def admin_dashboard():
    return render_template("admin_dashboard.html", owner_email=session.get("owner_email"))


@app.route("/api/admin/overview")
@owner_required
def api_admin_overview():
    db = get_db()
    money_in = db.execute("SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'in'").fetchone()[0]
    money_out = db.execute("SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'out'").fetchone()[0]
    sav_in = db.execute("SELECT COALESCE(SUM(amount), 0) FROM savings WHERE type IN ('deposit', 'auto')").fetchone()[0]
    sav_out = db.execute("SELECT COALESCE(SUM(amount), 0) FROM savings WHERE type = 'withdrawal'").fetchone()[0]

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    orders_today = db.execute(
        "SELECT COUNT(*) FROM orders WHERE substr(created_at, 1, 10) = ?", (today,)
    ).fetchone()[0]

    threshold = int(get_setting("low_stock_threshold", "5") or 5)
    low_stock = db.execute(
        """
        SELECT p.id, p.sku, p.name, p.stock, p.price, c.name AS category_name
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.stock <= ? ORDER BY p.stock ASC
        """,
        (threshold,),
    ).fetchall()

    daily_series = db.execute(
        """
        SELECT date,
               COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE 0 END), 0) AS revenue,
               COALESCE(SUM(CASE WHEN type = 'out' THEN amount ELSE 0 END), 0) AS expenses
        FROM transactions GROUP BY date ORDER BY date ASC LIMIT 30
        """
    ).fetchall()

    product_insights = db.execute(
        """
        SELECT p.id, p.sku, p.name, p.price, p.cost_price, p.stock, p.image_url,
               c.name AS category_name,
               COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN oi.quantity ELSE 0 END), 0) AS units_sold,
               COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN oi.unit_price * oi.quantity ELSE 0 END), 0) AS revenue,
               COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN (oi.unit_price - oi.unit_cost) * oi.quantity ELSE 0 END), 0) AS profit
        FROM products p
        JOIN categories c ON c.id = p.category_id
        LEFT JOIN order_items oi ON oi.product_id = p.id
        LEFT JOIN orders o ON o.id = oi.order_id
        GROUP BY p.id
        ORDER BY revenue DESC, units_sold DESC
        """
    ).fetchall()

    orders_by_status = db.execute(
        "SELECT status, COUNT(*) AS count FROM orders GROUP BY status"
    ).fetchall()

    return jsonify({
        "kpis": {
            "totalRevenue": round(money_in, 2),
            "totalExpenses": round(money_out, 2),
            "netProfit": round(money_in - money_out, 2),
            "savingsBalance": round(sav_in - sav_out, 2),
            "savingsGoal": float(get_setting("savings_goal", "5000")),
            "savingsPercentage": float(get_setting("savings_percentage", "15")),
            "ordersToday": orders_today,
            "lowStockCount": len(low_stock),
            "lowStockThreshold": threshold,
        },
        "lowStockProducts": [dict(r) for r in low_stock],
        "dailySeries": [dict(r) for r in daily_series],
        "productInsights": [dict(r) for r in product_insights],
        "ordersByStatus": [dict(r) for r in orders_by_status],
    })


@app.route("/api/admin/orders")
@owner_required
def api_admin_orders():
    db = get_db()
    orders = db.execute("SELECT * FROM orders ORDER BY created_at DESC, id DESC").fetchall()
    result = []
    for o in orders:
        d = dict(o)
        items = db.execute("SELECT * FROM order_items WHERE order_id = ?", (o["id"],)).fetchall()
        d["items"] = [dict(i) for i in items]
        result.append(d)
    return jsonify(result)


@app.route("/api/admin/orders/<int:order_id>/status", methods=["PATCH"])
@owner_required
def api_admin_update_order_status(order_id: int):
    data = request.get_json(silent=True) or {}
    new_status = (data.get("status") or "").strip()
    if new_status not in VALID_ORDER_STATUSES:
        return jsonify({"error": "Invalid order status."}), 400

    db = get_db()
    order = db.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not order:
        return jsonify({"error": "Order not found."}), 404

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now = datetime.now(timezone.utc).isoformat()

    if new_status == "Cancelled" and order["status"] != "Cancelled":
        for item in db.execute("SELECT product_id, quantity FROM order_items WHERE order_id = ?", (order_id,)):
            db.execute("UPDATE products SET stock = stock + ? WHERE id = ?", (item["quantity"], item["product_id"]))
    elif order["status"] == "Cancelled" and new_status != "Cancelled":
        for item in db.execute("SELECT product_id, quantity FROM order_items WHERE order_id = ?", (order_id,)):
            db.execute("UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?", (item["quantity"], item["product_id"]))

    paid_recorded = order["paid_recorded"]
    if new_status == "Paid" and paid_recorded == 0:
        paid_recorded = 1
        db.execute(
            """
            INSERT INTO transactions (type, amount, category, note, date, order_id, created_at)
            VALUES ('in', ?, 'Order Revenue', ?, ?, ?, ?)
            """,
            (order["total"], f"Order {order['order_number']} ({order['customer_name']})", today, order_id, now),
        )
        pct = float(get_setting("savings_percentage", "15") or 0)
        if pct > 0:
            save_amt = round(order["total"] * pct / 100.0, 2)
            if save_amt > 0:
                db.execute(
                    """
                    INSERT INTO savings (type, amount, note, order_id, date, created_at)
                    VALUES ('auto', ?, ?, ?, ?, ?)
                    """,
                    (save_amt, f"{pct:g}% auto-set-aside from {order['order_number']}", order_id, today, now),
                )

    db.execute("UPDATE orders SET status = ?, paid_recorded = ? WHERE id = ?", (new_status, paid_recorded, order_id))
    db.commit()

    refreshed = dict(db.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone())
    refreshed["items"] = [dict(i) for i in db.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,))]
    return jsonify(refreshed)


@app.route("/api/admin/orders/export")
@owner_required
def api_export_orders():
    rows = get_db().execute("SELECT * FROM orders ORDER BY created_at DESC").fetchall()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Order Number", "Customer Name", "Email", "Phone", "Address", "Payment", "Status", "Subtotal", "Shipping", "Total", "Created At"])
    for r in rows:
        writer.writerow([
            csv_safe(r["order_number"]), csv_safe(r["customer_name"]), csv_safe(r["customer_email"]),
            csv_safe(r["customer_phone"]), csv_safe(r["shipping_address"]), csv_safe(r["payment_method"]),
            csv_safe(r["status"]), f"{r['subtotal']:.2f}", f"{r['shipping_fee']:.2f}",
            f"{r['total']:.2f}", csv_safe(r["created_at"]),
        ])
    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": 'attachment; filename="sturex-orders.csv"'},
    )


@app.route("/api/admin/products", methods=["GET", "POST"])
@owner_required
def api_admin_products():
    db = get_db()
    if request.method == "GET":
        rows = db.execute(
            """
            SELECT p.*, c.name AS category_name, c.slug AS category_slug,
                   COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN oi.quantity ELSE 0 END), 0) AS units_sold,
                   COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN oi.unit_price * oi.quantity ELSE 0 END), 0) AS total_revenue,
                   COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN (oi.unit_price - oi.unit_cost) * oi.quantity ELSE 0 END), 0) AS total_profit
            FROM products p
            JOIN categories c ON c.id = p.category_id
            LEFT JOIN order_items oi ON oi.product_id = p.id
            LEFT JOIN orders o ON o.id = oi.order_id
            GROUP BY p.id ORDER BY p.id DESC
            """
        ).fetchall()
        return jsonify([dict(r) for r in rows])

    data = request.get_json(silent=True) or {}
    try:
        name = (data.get("name") or "").strip()
        sku = (data.get("sku") or "").strip().upper()
        desc = (data.get("description") or "").strip()
        cat_id = int(data.get("category_id", 0))
        price = float(data.get("price", 0))
        cost_price = float(data.get("cost_price", 0))
        stock = int(data.get("stock", 0))
        image_url = (data.get("image_url") or "").strip()
        featured = 1 if data.get("featured") else 0
        if len(name) < 2 or len(sku) < 2 or price <= 0 or cost_price < 0 or stock < 0:
            return jsonify({"error": "Invalid product fields."}), 400
        if not (image_url.startswith("/") or image_url.startswith("https://") or image_url.startswith("http://")):
            return jsonify({"error": "Invalid image URL."}), 400

        slug = f"{slugify(name)}-{secrets.token_hex(2)}"
        cur = db.execute(
            """
            INSERT INTO products (sku, name, slug, description, category_id, price, cost_price, stock, image_url, featured, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (sku, name, slug, desc, cat_id, round(price, 2), round(cost_price, 2), stock, image_url, featured, datetime.now(timezone.utc).isoformat()),
        )
        db.commit()
        return jsonify(dict(db.execute("SELECT * FROM products WHERE id = ?", (cur.lastrowid,)).fetchone())), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "A product with that SKU already exists."}), 400


@app.route("/api/admin/products/<int:product_id>", methods=["PUT", "DELETE"])
@owner_required
def api_admin_product_item(product_id: int):
    db = get_db()
    if request.method == "DELETE":
        refs = db.execute("SELECT COUNT(*) FROM order_items WHERE product_id = ?", (product_id,)).fetchone()[0]
        if refs > 0:
            return jsonify({"error": "Cannot delete a product with historical orders. Set stock to 0 instead."}), 400
        cur = db.execute("DELETE FROM products WHERE id = ?", (product_id,))
        db.commit()
        if cur.rowcount == 0:
            return jsonify({"error": "Product not found."}), 404
        return jsonify({"ok": True})

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    sku = (data.get("sku") or "").strip().upper()
    desc = (data.get("description") or "").strip()
    cat_id = int(data.get("category_id", 0))
    price = float(data.get("price", 0))
    cost_price = float(data.get("cost_price", 0))
    stock = int(data.get("stock", 0))
    image_url = (data.get("image_url") or "").strip()
    featured = 1 if data.get("featured") else 0
    if len(name) < 2 or len(sku) < 2 or price <= 0 or cost_price < 0 or stock < 0:
        return jsonify({"error": "Invalid product fields."}), 400

    db.execute(
        """
        UPDATE products SET sku=?, name=?, description=?, category_id=?, price=?, cost_price=?, stock=?, image_url=?, featured=?
        WHERE id=?
        """,
        (sku, name, desc, cat_id, round(price, 2), round(cost_price, 2), stock, image_url, featured, product_id),
    )
    db.commit()
    return jsonify(dict(db.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()))


@app.route("/api/admin/upload", methods=["POST"])
@owner_required
def api_admin_upload():
    file = request.files.get("image")
    if not file or not file.filename:
        return jsonify({"error": "No image provided."}), 400
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": "Only JPG, PNG, and WebP files are allowed."}), 400
    filename = f"prod_{uuid.uuid4().hex}{ext}"
    dest = os.path.abspath(os.path.join(UPLOAD_DIR, filename))
    if not dest.startswith(UPLOAD_DIR + os.sep):
        return jsonify({"error": "Invalid upload path."}), 400
    file.save(dest)
    return jsonify({"imageUrl": f"/static/uploads/{filename}"}), 201


@app.route("/api/admin/ledger", methods=["GET", "POST"])
@owner_required
def api_admin_ledger():
    db = get_db()
    if request.method == "GET":
        rows = db.execute("SELECT * FROM transactions ORDER BY date DESC, id DESC").fetchall()
        return jsonify([dict(r) for r in rows])

    data = request.get_json(silent=True) or {}
    tx_type = "in" if data.get("type") == "in" else "out"
    amount = float(data.get("amount", 0))
    category = (data.get("category") or "Other").strip()
    date_str = (data.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")).strip()
    note = (data.get("note") or "").strip()[:240]
    if amount <= 0:
        return jsonify({"error": "Amount must be greater than zero."}), 400

    cur = db.execute(
        "INSERT INTO transactions (type, amount, category, note, date, order_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
        (tx_type, round(amount, 2), category, note, date_str, datetime.now(timezone.utc).isoformat()),
    )
    db.commit()
    return jsonify(dict(db.execute("SELECT * FROM transactions WHERE id = ?", (cur.lastrowid,)).fetchone())), 201


@app.route("/api/admin/ledger/<int:tx_id>", methods=["DELETE"])
@owner_required
def api_admin_delete_ledger(tx_id: int):
    db = get_db()
    row = db.execute("SELECT order_id FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if not row:
        return jsonify({"error": "Transaction not found."}), 404
    if row["order_id"] is not None:
        return jsonify({"error": "Automatic order revenue transactions cannot be deleted."}), 400
    db.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/ledger/export")
@owner_required
def api_export_ledger():
    rows = get_db().execute("SELECT * FROM transactions ORDER BY date DESC, id DESC").fetchall()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["ID", "Date", "Type", "Category", "Amount", "Note", "Order ID"])
    for r in rows:
        writer.writerow([
            r["id"], csv_safe(r["date"]), "Money In" if r["type"] == "in" else "Money Out",
            csv_safe(r["category"]), f"{r['amount']:.2f}", csv_safe(r["note"]), r["order_id"] or "",
        ])
    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": 'attachment; filename="sturex-ledger.csv"'},
    )


@app.route("/api/admin/savings", methods=["GET", "POST"])
@owner_required
def api_admin_savings():
    db = get_db()
    if request.method == "GET":
        sav_in = db.execute("SELECT COALESCE(SUM(amount), 0) FROM savings WHERE type IN ('deposit', 'auto')").fetchone()[0]
        sav_out = db.execute("SELECT COALESCE(SUM(amount), 0) FROM savings WHERE type = 'withdrawal'").fetchone()[0]
        history = db.execute("SELECT * FROM savings ORDER BY date DESC, id DESC").fetchall()
        return jsonify({
            "balance": round(sav_in - sav_out, 2),
            "goal": float(get_setting("savings_goal", "5000")),
            "percentage": float(get_setting("savings_percentage", "15")),
            "history": [dict(h) for h in history],
        })

    data = request.get_json(silent=True) or {}
    sav_type = "withdrawal" if data.get("type") == "withdrawal" else "deposit"
    amount = float(data.get("amount", 0))
    date_str = (data.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")).strip()
    note = (data.get("note") or "").strip()[:200]
    if amount <= 0:
        return jsonify({"error": "Amount must be greater than zero."}), 400

    if sav_type == "withdrawal":
        sav_in = db.execute("SELECT COALESCE(SUM(amount), 0) FROM savings WHERE type IN ('deposit', 'auto')").fetchone()[0]
        sav_out = db.execute("SELECT COALESCE(SUM(amount), 0) FROM savings WHERE type = 'withdrawal'").fetchone()[0]
        if amount > (sav_in - sav_out):
            return jsonify({"error": "Withdrawal exceeds current savings balance."}), 400

    cur = db.execute(
        "INSERT INTO savings (type, amount, note, order_id, date, created_at) VALUES (?, ?, ?, NULL, ?, ?)",
        (sav_type, round(amount, 2), note or sav_type.title(), date_str, datetime.now(timezone.utc).isoformat()),
    )
    db.commit()
    return jsonify(dict(db.execute("SELECT * FROM savings WHERE id = ?", (cur.lastrowid,)).fetchone())), 201


@app.route("/api/admin/settings", methods=["PUT"])
@owner_required
def api_admin_settings():
    data = request.get_json(silent=True) or {}
    db = get_db()
    if "savings_goal" in data:
        g_val = float(data["savings_goal"])
        if g_val <= 0:
            return jsonify({"error": "Savings goal must be positive."}), 400
        db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('savings_goal', ?)", (str(round(g_val, 2)),))
    if "savings_percentage" in data:
        p_val = float(data["savings_percentage"])
        if p_val < 0 or p_val > 100:
            return jsonify({"error": "Savings percentage must be 0-100."}), 400
        db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('savings_percentage', ?)", (str(round(p_val, 2)),))
    db.commit()
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
