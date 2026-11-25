"""
Sturex Database Seed Script
---------------------------
Populates `sturex.db` with:
  - 1 demo owner account (configurable via ADMIN_EMAIL / ADMIN_PASSWORD env vars)
  - 4 product categories
  - 12 curated studio products (with cost price, selling price, and stock)
  - 5 sample orders + order items
  - Automatic revenue + manual operating expense ledger entries
  - Savings goal settings and initial savings history

Run with:
  python seed.py
"""

import os
import sqlite3
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash

load_dotenv()

DB_PATH = os.environ.get("DATABASE_PATH", "sturex.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def create_tables(conn):
    """Create all 8 core database tables if they do not already exist."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT 'Studio Owner',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            description TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            description TEXT NOT NULL,
            category_id INTEGER NOT NULL,
            price REAL NOT NULL,
            cost_price REAL NOT NULL,
            stock INTEGER NOT NULL DEFAULT 0,
            image_url TEXT NOT NULL,
            featured INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (category_id) REFERENCES categories(id)
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT UNIQUE NOT NULL,
            customer_name TEXT NOT NULL,
            customer_email TEXT NOT NULL,
            customer_phone TEXT NOT NULL,
            shipping_address TEXT NOT NULL,
            payment_method TEXT NOT NULL,
            payment_reference TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'Pending',
            subtotal REAL NOT NULL,
            shipping_fee REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL,
            paid_recorded INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            product_name TEXT NOT NULL,
            unit_price REAL NOT NULL,
            unit_cost REAL NOT NULL,
            quantity INTEGER NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id)
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL CHECK(type IN ('in', 'out')),
            amount REAL NOT NULL,
            category TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            date TEXT NOT NULL,
            order_id INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS savings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL CHECK(type IN ('deposit', 'withdrawal', 'auto')),
            amount REAL NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            order_id INTEGER,
            date TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )


def seed():
    conn = get_connection()
    create_tables(conn)
    now = datetime.now(timezone.utc).isoformat()

    # 1. Seed default store settings
    default_settings = {
        "savings_goal": "5000",
        "savings_percentage": "15",
        "low_stock_threshold": "5",
        "store_currency": "USD",
        "payment_gateway": "manual",
        "bank_account_info": "Sturex Studio LLC · Routing 021000021 · Acct 8841-9024-11",
    }
    for key, val in default_settings.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (key, val),
        )

    # 2. Seed single demo owner account if no owner exists yet
    existing_owner = conn.execute("SELECT id FROM users LIMIT 1").fetchone()
    if not existing_owner:
        owner_email = os.environ.get("ADMIN_EMAIL", "owner@sturex.store").strip().lower()
        owner_password = os.environ.get("ADMIN_PASSWORD", "").strip() or "SturexOwner!2026"
        conn.execute(
            "INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)",
            (owner_email, generate_password_hash(owner_password), "Sturex Owner", now),
        )
        print(f"[seed] Created demo owner account: {owner_email}")

    # 3. Seed categories and 12 products if products table is empty
    existing_products = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    if existing_products == 0:
        categories = [
            ("Desk Hardware", "desk-hardware", "Precision CNC-machined tools and tactile desktop instruments."),
            ("Lighting", "lighting", "Architectural task and ambient lighting in brushed metals."),
            ("Carry & Leather", "carry-leather", "Vegetable-tanned leather folios, waxed canvas, and travel essentials."),
            ("Audio & Living", "audio-living", "Minimalist studio acoustics, stoneware vessels, and desk objects."),
        ]
        for name, slug, desc in categories:
            conn.execute(
                "INSERT OR IGNORE INTO categories (name, slug, description) VALUES (?, ?, ?)",
                (name, slug, desc),
            )

        cat_rows = conn.execute("SELECT id, slug FROM categories").fetchall()
        cat_map = {row["slug"]: row["id"] for row in cat_rows}

        products = [
            ("STX-LMP-01", "Aether Task Lamp", "aether-task-lamp",
             "CNC-extruded brushed anodized aluminum cantilever desk lamp with stepless warm-to-daylight dimming (2700K–4500K) and weighted steel base.",
             cat_map["lighting"], 245.0, 105.0, 14, "/src/assets/images/prod_aether_lamp_1795599005333.jpg", 1),
            ("STX-DCK-02", "Monolith Mag Dock", "monolith-mag-dock",
             "Solid bead-blasted matte black 6061 aluminum 15W magnetic wireless charging stand angled at 62 degrees for effortless desk glanceability.",
             cat_map["desk-hardware"], 118.0, 46.0, 22, "/src/assets/images/prod_monolith_dock_1795599005618.jpg", 1),
            ("STX-KRO-03", "Kuro Ceramic Pour-Over", "kuro-ceramic-pour-over",
             "Hand-thrown matte black stoneware dripper and double-walled carafe with integrated borosilicate brew window for studio morning rituals.",
             cat_map["audio-living"], 94.0, 38.0, 18, "/src/assets/images/prod_kuro_pourover_1795599006407.jpg", 1),
            ("STX-KBD-04", "Sora 65 Mechanical Keyboard", "sora-65-mechanical-keyboard",
             "Gasket-mounted silver anodized 65% mechanical keyboard with PBT charcoal keycaps, hot-swappable tactile switches, and a knurled solid brass encoder.",
             cat_map["desk-hardware"], 289.0, 132.0, 9, "/src/assets/images/prod_sora_keyboard_1795599006365.jpg", 1),
            ("STX-LTH-05", "Vesper Leather Folio", "vesper-leather-folio",
             "Full-grain Italian vegetable-tanned cognac leather laptop sleeve lined with soft microfiber and secured by solid brass post studs.",
             cat_map["carry-leather"], 165.0, 68.0, 4, "/src/assets/images/prod_vesper_folio_1795599006905.jpg", 0),
            ("STX-AUD-06", "Pulse Field Speaker", "pulse-field-speaker",
             "Reference-tuned portable studio monitor wrapped in brushed aluminum and woven acoustic wool with 18-hour USB-C battery life.",
             cat_map["audio-living"], 320.0, 148.0, 7, "/src/assets/images/prod_pulse_speaker_1795599007305.jpg", 1),
            ("STX-LMP-07", "Lumen Orbital Light", "lumen-orbital-light",
             "Hand-blown opal glass diffuser cradled inside an angled brushed brass ring on a matte mineral plinth. Emits warm 2400K ambient glow.",
             cat_map["lighting"], 210.0, 89.0, 11, "/src/assets/images/prod_lumen_light_1795599007483.jpg", 0),
            ("STX-MAT-08", "Merino Studio Mat", "merino-studio-mat",
             "4mm dense German merino wool felt workspace mat finished with hand-stitched saddle leather edge trim and travel snap strap.",
             cat_map["desk-hardware"], 88.0, 31.0, 26, "/src/assets/images/prod_merino_mat_1795599007948.jpg", 0),
            ("STX-FLK-09", "Nomad Titanium Flask", "nomad-titanium-flask",
             "Double-wall vacuum-insulated Grade 1 titanium 500ml bottle with diamond-knurled screw cap and zero metallic aftertaste.",
             cat_map["carry-leather"], 76.0, 29.0, 19, "/src/assets/images/prod_nomad_flask_1795599009374.jpg", 0),
            ("STX-PEN-10", "Arc Brass Pen & Stand", "arc-brass-pen-stand",
             "Precision-turned C36000 solid brass rollerball pen with diamond-knurled grip, Schmidt P8126 refill, and angled anodized aluminum cradle.",
             cat_map["desk-hardware"], 92.0, 34.0, 3, "/src/assets/images/prod_arc_pen_1795599009183.jpg", 0),
            ("STX-TRY-11", "Forma Fluted Valet Tray", "forma-fluted-valet-tray",
             "Slip-cast matte limestone ceramic catchall tray with architectural fluting for everyday keys, watches, and studio instruments.",
             cat_map["audio-living"], 54.0, 18.0, 31, "/src/assets/images/prod_forma_tray_1795599009195.jpg", 0),
            ("STX-BAG-12", "Drift Canvas Weekender", "drift-canvas-weekender",
             "18oz Scottish waxed cotton canvas duffle reinforced with English bridle leather handles, matte black steel hardware, and padded 16-inch laptop sleeve.",
             cat_map["carry-leather"], 275.0, 118.0, 6, "/src/assets/images/prod_drift_weekender_1795599009527.jpg", 1),
        ]

        product_ids = {}
        for p in products:
            cur = conn.execute(
                """
                INSERT INTO products (sku, name, slug, description, category_id, price, cost_price, stock, image_url, featured, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (*p, now),
            )
            product_ids[p[0]] = cur.lastrowid

        # 4. Seed 5 sample orders + ledger + auto-savings
        def days_ago(days):
            return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        sample_orders = [
            ("STX-1038", "Elena Vance", "elena.vance@example.com", "+1 (415) 555-0192",
             "412 Mercer St, Apt 4B, Seattle, WA 98109", "bank_transfer", "Delivered", 1, days_ago(18),
             [("STX-LMP-01", "Aether Task Lamp", 245.0, 105.0, 1), ("STX-MAT-08", "Merino Studio Mat", 88.0, 31.0, 1)]),
            ("STX-1039", "Marcus Thorne", "m.thorne@example.com", "+1 (312) 555-0148",
             "890 W Fulton Market, Chicago, IL 60607", "bank_transfer", "Delivered", 1, days_ago(12),
             [("STX-KBD-04", "Sora 65 Mechanical Keyboard", 289.0, 132.0, 1), ("STX-PEN-10", "Arc Brass Pen & Stand", 92.0, 34.0, 1)]),
            ("STX-1040", "Nadia Okafor", "nadia@studio-okafor.com", "+1 (646) 555-0183",
             "214 Wythe Ave, Brooklyn, NY 11249", "pay_on_delivery", "Shipped", 1, days_ago(6),
             [("STX-AUD-06", "Pulse Field Speaker", 320.0, 148.0, 1), ("STX-TRY-11", "Forma Fluted Valet Tray", 54.0, 18.0, 2)]),
            ("STX-1041", "Daniel Lindqvist", "daniel.l@example.com", "+1 (512) 555-0124",
             "1204 S Congress Ave, Austin, TX 78704", "bank_transfer", "Paid", 1, days_ago(2),
             [("STX-BAG-12", "Drift Canvas Weekender", 275.0, 118.0, 1), ("STX-FLK-09", "Nomad Titanium Flask", 76.0, 29.0, 1)]),
            ("STX-1042", "Clara Chen", "clara.chen@example.com", "+1 (213) 555-0167",
             "742 Mateo St, Los Angeles, CA 90021", "pay_on_delivery", "Pending", 0, days_ago(0),
             [("STX-DCK-02", "Monolith Mag Dock", 118.0, 46.0, 1), ("STX-KRO-03", "Kuro Ceramic Pour-Over", 94.0, 38.0, 1)]),
        ]

        for order_num, cname, cemail, cphone, addr, method, status, paid_rec, created, items in sample_orders:
            subtotal = sum(i[2] * i[4] for i in items)
            shipping = 0.0 if subtotal >= 150 else 12.0
            total = subtotal + shipping
            cur = conn.execute(
                """
                INSERT INTO orders (
                    order_number, customer_name, customer_email, customer_phone,
                    shipping_address, payment_method, payment_reference, status,
                    subtotal, shipping_fee, total, paid_recorded, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (order_num, cname, cemail, cphone, addr, method, f"REF-{order_num}", status,
                 subtotal, shipping, total, paid_rec, created),
            )
            order_id = cur.lastrowid
            for sku, pname, uprice, ucost, qty in items:
                conn.execute(
                    """
                    INSERT INTO order_items (order_id, product_id, product_name, unit_price, unit_cost, quantity)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (order_id, product_ids[sku], pname, uprice, ucost, qty),
                )
            if paid_rec == 1:
                date_str = created[:10]
                conn.execute(
                    """
                    INSERT INTO transactions (type, amount, category, note, date, order_id, created_at)
                    VALUES ('in', ?, 'Order Revenue', ?, ?, ?, ?)
                    """,
                    (total, f"Order {order_num} ({cname})", date_str, order_id, created),
                )
                save_amt = round(total * 0.15, 2)
                conn.execute(
                    """
                    INSERT INTO savings (type, amount, note, order_id, date, created_at)
                    VALUES ('auto', ?, ?, ?, ?, ?)
                    """,
                    (save_amt, f"15% auto-set-aside from {order_num}", order_id, date_str, created),
                )

        # 5. Seed sample manual operating expenses and initial savings deposit
        expenses = [
            (420.0, "Restock", "Batch restock: Merino mats & ceramic trays", days_ago(16)[:10]),
            (95.5, "Delivery", "Courier fulfillment & protective packaging", days_ago(10)[:10]),
            (145.0, "Ads", "Architectural Digest digital placement", days_ago(4)[:10]),
        ]
        for amt, cat, note, dt in expenses:
            conn.execute(
                "INSERT INTO transactions (type, amount, category, note, date, order_id, created_at) VALUES ('out', ?, ?, ?, ?, NULL, ?)",
                (amt, cat, note, dt, now),
            )

        conn.execute(
            "INSERT INTO savings (type, amount, note, order_id, date, created_at) VALUES ('deposit', 500.0, 'Initial studio reserve seed', NULL, ?, ?)",
            (days_ago(20)[:10], days_ago(20)),
        )
        print("[seed] Seeded 12 products, 5 orders, ledger transactions, and savings history.")

    conn.commit()
    conn.close()


if __name__ == "__main__":
    seed()
