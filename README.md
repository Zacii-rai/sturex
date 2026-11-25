# Sturex — Studio Objects & Hardware E-Commerce + Owner Studio

**Sturex** is a minimalist, responsive e-commerce storefront and private business operations dashboard built as a flagship portfolio piece.

---

## Features

### Public Storefront (`/`)
- **Editorial Hero & Featured Objects**: Split architectural layout with curated studio photography.
- **Interactive Catalog**: Live search, category filter tabs, and price sorting (`Featured`, `Low to High`, `High to Low`).
- **Product Detail Page**: High-resolution studio imagery, SKU, stock availability, and quantity stepper.
- **Persistent Cart & Checkout**: `localStorage`-backed cart drawer with free shipping progress ($150+ threshold), customer validation, and **Pay on Delivery / Bank Transfer** checkout structured for easy Paystack or Flutterwave integration.
- **Order Tracking**: Customers can look up live order status using their Order Number and email address.
- **Dark / Light Mode**: Instant theme switcher persisted across sessions.

### Private Owner Studio (`/admin`)
- **Single-Owner Authentication**: Session-based authentication with `scrypt` / `werkzeug.security` password hashing, CSRF token validation, and IP-based login rate limiting. Public admin registration is disabled.
- **Overview & Chart.js Analytics**: Real-time KPI cards (Total Revenue, Total Expenses, Net Profit, Savings Balance, Orders Today, Low-Stock Alerts) alongside Revenue vs. Expenses, Sales by Product, and Orders by Status charts.
- **Orders & Printable Invoices**: Filter by status, update order status inline (marking an order `Paid` automatically records revenue in the Money Ledger and sets aside the configured savings percentage), inspect details in a slide-over panel, print/export invoices, and export CSV.
- **Products & Margin Insights**: Full product CRUD with image uploads, selling price vs. cost price margin calculation, low-stock indicators, and per-product units sold / revenue / profit insights.
- **Money In / Out Ledger**: Automatic order revenue entries plus manual expense tracking (`Restock`, `Delivery`, `Ads`, `Operations`) and CSV export.
- **Savings & Goals**: Configurable savings goal and auto-save percentage per sale, progress bar, manual deposits/withdrawals, and full history.

---

## Folder Structure

```text
sturex/
├── app.py                   # Flask application, auth, CSRF, storefront & admin APIs
├── seed.py                  # Database initializer + 12 products, demo owner, sample orders
├── requirements.txt         # Python dependencies (Flask, Werkzeug, python-dotenv, gunicorn)
├── templates/               # Jinja2 HTML templates (Tailwind CSS + Chart.js via CDN)
│   ├── base.html
│   ├── storefront.html
│   ├── product_detail.html
│   ├── admin_login.html
│   └── admin_dashboard.html
├── static/
│   ├── js/
│   │   ├── storefront.js    # Vanilla JS catalog, cart, checkout & tracking
│   │   └── admin.js         # Vanilla JS single-page owner dashboard & charts
│   └── uploads/             # Uploaded product images
├── server.ts                # Node/Express + Vite runtime wrapper for AI Studio preview
├── src/                     # TypeScript/React preview components + studio product images
└── .env.example             # Environment variable template
```

---

## Running Locally with Python Flask

1. **Create a virtual environment and install dependencies:**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate   # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Configure environment variables:**
   Copy `.env.example` to `.env` and set a strong `SECRET_KEY`:
   ```bash
   cp .env.example .env
   ```

3. **Seed the SQLite database (`sturex.db`):**
   ```bash
   python seed.py
   ```

4. **Start the Flask server:**
   ```bash
   python app.py
   ```
   Open `http://127.0.0.1:5000` in your browser.

---

## How to Log In as the Owner

- If you ran `python seed.py`, a demo owner account is created using `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` (defaults to `owner@sturex.store` / `SturexOwner!2026` if `ADMIN_PASSWORD` is left blank during local seeding).
- If you start with an empty `users` table (without running `seed.py`), navigating to `/admin` displays a **First-Run Owner Setup** form so you can claim the single owner account directly in the browser.
- **Important**: Always set a strong `ADMIN_PASSWORD` and `SECRET_KEY` in production.

---

## Deploying

### Render (Recommended)
1. Push the repository to GitHub.
2. Create a new **Web Service** on Render.
3. Set **Build Command**: `pip install -r requirements.txt && python seed.py`
4. Set **Start Command**: `gunicorn app:app`
5. Add Environment Variables:
   - `SECRET_KEY`: a 32+ character random string
   - `ADMIN_EMAIL`: your owner email
   - `ADMIN_PASSWORD`: your strong owner password

### PythonAnywhere
1. Upload your project files and create a virtualenv: `pip install -r requirements.txt`.
2. Run `python seed.py` in the Bash console to initialize `sturex.db`.
3. Configure your **WSGI configuration file** to import `app` from `app.py` and set `SECRET_KEY` in the WSGI/env setup.
