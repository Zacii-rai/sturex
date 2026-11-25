import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import db, {
  hashPassword,
  initSchema,
  seedInitialCatalogIfEmpty,
  verifyPassword,
} from './src/db/database.ts';

dotenv.config();

initSchema();
seedInitialCatalogIfEmpty();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

// Trust AI Studio / Cloud Run reverse proxy for secure cookies & IP rate limiting
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Ensure upload directory exists and confine uploaded files strictly inside it
const UPLOAD_DIR = path.resolve(process.cwd(), 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// Multer configuration for product image uploads (2MB max, image allowlist)
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = ALLOWED_MIME[file.mimetype] || '.jpg';
      const safeName = `prod_${crypto.randomUUID()}${ext}`;
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and WebP images are allowed.'));
    }
  },
});

// Rate limiter for owner login (5 failed attempts per 15 minutes per IP)
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const loginFailures = new Map<string, number[]>();

function isRateLimited(ip: string): { limited: boolean; retryAfterSec: number } {
  const now = Date.now();
  const timestamps = (loginFailures.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  loginFailures.set(ip, timestamps);
  if (timestamps.length >= MAX_LOGIN_ATTEMPTS) {
    const oldest = timestamps[0];
    const retryAfterSec = Math.ceil((LOGIN_WINDOW_MS - (now - oldest)) / 1000);
    return { limited: true, retryAfterSec };
  }
  return { limited: false, retryAfterSec: 0 };
}

function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const timestamps = (loginFailures.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  timestamps.push(now);
  loginFailures.set(ip, timestamps);
}

// Parse Cookie header safely
function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

const SESSION_COOKIE = 'sturex_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isHttps) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
  ];
  if (isHttps) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

interface SessionRow {
  token: string;
  user_id: number;
  csrf_token: string;
  expires_at: number;
  email: string;
  name: string;
}

function getActiveSession(req: Request): SessionRow | null {
  const cookies = parseCookies(req.headers.cookie);
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : undefined;
  const token = cookies[SESSION_COOKIE] || bearer;
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT s.token, s.user_id, s.csrf_token, s.expires_at, u.email, u.name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as SessionRow | undefined;

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return row;
}

function createSession(userId: number): { token: string; csrfToken: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.prepare(
    'INSERT INTO sessions (token, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(token, userId, csrfToken, expiresAt, new Date().toISOString());
  return { token, csrfToken };
}

interface AuthedRequest extends Request {
  ownerSession?: SessionRow;
}

function requireOwner(req: AuthedRequest, res: Response, next: NextFunction): void {
  const session = getActiveSession(req);
  if (!session) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Enforce CSRF check on all state-changing mutations
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const headerCsrf = String(req.headers['x-csrf-token'] || '');
    const expected = Buffer.from(session.csrf_token);
    const provided = Buffer.from(headerCsrf);
    if (
      expected.length === 0 ||
      provided.length !== expected.length ||
      !crypto.timingSafeEqual(expected, provided)
    ) {
      res.status(403).json({ error: 'Invalid or missing CSRF token' });
      return;
    }
  }

  req.ownerSession = session;
  next();
}

function csvSafeCell(value: unknown): string {
  let str = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getSetting(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : fallback;
}

// ============================================================================
// AUTHENTICATION ROUTES (Owner only — no public registration)
// ============================================================================

app.get('/api/auth/status', (req: Request, res: Response) => {
  const ownerRow = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: number } | undefined;
  const session = getActiveSession(req);
  res.json({
    needsSetup: !ownerRow,
    authenticated: Boolean(session),
    user: session ? { email: session.email, name: session.name } : null,
    csrfToken: session ? session.csrf_token : null,
  });
});

app.post('/api/auth/setup', (req: Request, res: Response) => {
  const { email, password, name } = req.body || {};
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'Studio Owner';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: 'Please enter a valid owner email address.' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }

  const setupResult = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM users LIMIT 1').get();
    if (existing) {
      return null;
    }
    const info = db
      .prepare('INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)')
      .run(cleanEmail, hashPassword(password), cleanName, new Date().toISOString());
    return Number(info.lastInsertRowid);
  })();

  if (!setupResult) {
    res.status(403).json({ error: 'Owner account is already configured.' });
    return;
  }

  const { token, csrfToken } = createSession(setupResult);
  setSessionCookie(req, res, token);
  res.status(201).json({
    authenticated: true,
    user: { email: cleanEmail, name: cleanName },
    csrfToken,
    token,
  });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const ip = req.ip || 'unknown';
  const rate = isRateLimited(ip);
  if (rate.limited) {
    res.status(429).json({
      error: `Too many failed login attempts. Try again in ${rate.retryAfterSec} seconds.`,
    });
    return;
  }

  const { email, password } = req.body || {};
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!cleanEmail || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const user = db
    .prepare('SELECT id, email, password_hash, name FROM users WHERE email = ?')
    .get(cleanEmail) as
    | { id: number; email: string; password_hash: string; name: string }
    | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    recordLoginFailure(ip);
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  loginFailures.delete(ip);
  const { token, csrfToken } = createSession(user.id);
  setSessionCookie(req, res, token);
  res.json({
    authenticated: true,
    user: { email: user.email, name: user.name },
    csrfToken,
    token,
  });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const session = getActiveSession(req);
  if (session) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(session.token);
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

// ============================================================================
// PUBLIC STOREFRONT ROUTES
// ============================================================================

app.get('/api/categories', (_req: Request, res: Response) => {
  const categories = db
    .prepare(
      `SELECT c.id, c.name, c.slug, c.description, COUNT(p.id) as product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id
       GROUP BY c.id
       ORDER BY c.name ASC`
    )
    .all();
  res.json(categories);
});

app.get('/api/store-info', (_req: Request, res: Response) => {
  res.json({
    currency: getSetting('store_currency', 'USD'),
    freeShippingThreshold: 150,
    standardShippingFee: 12,
    paymentGateway: getSetting('payment_gateway', 'manual'),
    bankAccountInfo: getSetting(
      'bank_account_info',
      'Sturex Studio LLC · Routing 021000021 · Acct 8841-9024-11'
    ),
  });
});

app.get('/api/products', (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'featured';
  const featuredOnly = req.query.featured === '1' || req.query.featured === 'true';

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (q) {
    clauses.push('(p.name LIKE ? OR p.description LIKE ? OR p.sku LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  if (category && category !== 'all') {
    clauses.push('c.slug = ?');
    params.push(category);
  }

  if (featuredOnly) {
    clauses.push('p.featured = 1');
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  let orderSql = 'ORDER BY p.featured DESC, p.id ASC';
  if (sort === 'price_asc') orderSql = 'ORDER BY p.price ASC';
  else if (sort === 'price_desc') orderSql = 'ORDER BY p.price DESC';

  const rows = db
    .prepare(
      `SELECT p.id, p.sku, p.name, p.slug, p.description, p.category_id,
              c.name as category_name, c.slug as category_slug,
              p.price, p.stock, p.image_url, p.featured, p.created_at
       FROM products p
       JOIN categories c ON c.id = p.category_id
       ${whereSql}
       ${orderSql}`
    )
    .all(...params);

  res.json(rows);
});

app.get('/api/products/:slugOrId', (req: Request, res: Response) => {
  const param = req.params.slugOrId;
  const row = db
    .prepare(
      `SELECT p.id, p.sku, p.name, p.slug, p.description, p.category_id,
              c.name as category_name, c.slug as category_slug,
              p.price, p.stock, p.image_url, p.featured, p.created_at
       FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE p.slug = ? OR p.id = ?`
    )
    .get(param, Number(param) || -1);

  if (!row) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.json(row);
});

// Structured Payment Adapter ready for Paystack / Flutterwave integration
interface PaymentAdapterResult {
  gateway: string;
  reference: string;
  instructions: string;
  authorizationUrl: string | null;
}

function createPaymentIntent(
  method: string,
  orderNumber: string,
  amount: number
): PaymentAdapterResult {
  const ref = `STX-${orderNumber.replace('STX-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const bankInfo = getSetting(
    'bank_account_info',
    'Sturex Studio LLC · Routing 021000021 · Acct 8841-9024-11'
  );

  if (method === 'bank_transfer') {
    return {
      gateway: 'bank_transfer',
      reference: ref,
      instructions: `Transfer $${amount.toFixed(2)} to ${bankInfo}. Include ${orderNumber} as your payment memo.`,
      authorizationUrl: null,
    };
  }
  // Future hook: if process.env.PAYSTACK_SECRET_KEY is configured, initialize Paystack / Flutterwave here
  return {
    gateway: 'pay_on_delivery',
    reference: ref,
    instructions: `Pay $${amount.toFixed(2)} via cash or card terminal upon courier delivery.`,
    authorizationUrl: null,
  };
}

app.post('/api/orders', (req: Request, res: Response) => {
  const { customer_name, customer_email, customer_phone, shipping_address, payment_method, items } =
    req.body || {};

  const name = typeof customer_name === 'string' ? customer_name.trim() : '';
  const email = typeof customer_email === 'string' ? customer_email.trim().toLowerCase() : '';
  const phone = typeof customer_phone === 'string' ? customer_phone.trim() : '';
  const address = typeof shipping_address === 'string' ? shipping_address.trim() : '';
  const method = payment_method === 'bank_transfer' ? 'bank_transfer' : 'pay_on_delivery';

  if (name.length < 2) {
    res.status(400).json({ error: 'Please enter your full name.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (phone.length < 6) {
    res.status(400).json({ error: 'Please enter a valid phone number.' });
    return;
  }
  if (address.length < 6) {
    res.status(400).json({ error: 'Please enter a complete shipping address.' });
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Your cart is empty.' });
    return;
  }

  try {
    const orderCreated = db.transaction(() => {
      const resolvedItems: Array<{
        product_id: number;
        product_name: string;
        unit_price: number;
        unit_cost: number;
        quantity: number;
      }> = [];

      let subtotal = 0;

      for (const rawItem of items) {
        const productId = Number(rawItem?.product_id);
        const qty = Number(rawItem?.quantity);
        if (!Number.isInteger(productId) || !Number.isInteger(qty) || qty < 1 || qty > 50) {
          throw new Error('Invalid cart item quantity.');
        }

        const product = db
          .prepare('SELECT id, name, price, cost_price, stock FROM products WHERE id = ?')
          .get(productId) as
          | { id: number; name: string; price: number; cost_price: number; stock: number }
          | undefined;

        if (!product) {
          throw new Error('One or more products in your cart no longer exist.');
        }
        if (product.stock < qty) {
          throw new Error(`Only ${product.stock} left in stock for ${product.name}.`);
        }

        db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, product.id);
        subtotal += product.price * qty;
        resolvedItems.push({
          product_id: product.id,
          product_name: product.name,
          unit_price: product.price,
          unit_cost: product.cost_price,
          quantity: qty,
        });
      }

      subtotal = Math.round(subtotal * 100) / 100;
      const shippingFee = subtotal >= 150 ? 0 : 12;
      const total = Math.round((subtotal + shippingFee) * 100) / 100;

      const lastRow = db.prepare('SELECT COALESCE(MAX(id), 0) as maxId FROM orders').get() as {
        maxId: number;
      };
      const orderNumber = `STX-${1040 + lastRow.maxId + 1}`;
      const paymentIntent = createPaymentIntent(method, orderNumber, total);
      const now = new Date().toISOString();

      const orderRes = db
        .prepare(
          `INSERT INTO orders (
            order_number, customer_name, customer_email, customer_phone,
            shipping_address, payment_method, payment_reference, status,
            subtotal, shipping_fee, total, paid_recorded, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, 0, ?)`
        )
        .run(
          orderNumber,
          name,
          email,
          phone,
          address,
          method,
          paymentIntent.reference,
          subtotal,
          shippingFee,
          total,
          now
        );

      const orderId = Number(orderRes.lastInsertRowid);
      const insertItem = db.prepare(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, unit_cost, quantity)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const item of resolvedItems) {
        insertItem.run(
          orderId,
          item.product_id,
          item.product_name,
          item.unit_price,
          item.unit_cost,
          item.quantity
        );
      }

      return {
        id: orderId,
        order_number: orderNumber,
        status: 'Pending',
        subtotal,
        shipping_fee: shippingFee,
        total,
        payment_method: method,
        payment: paymentIntent,
        items: resolvedItems,
        created_at: now,
      };
    })();

    res.status(201).json(orderCreated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to place order.';
    res.status(400).json({ error: message });
  }
});

app.get('/api/orders/track', (req: Request, res: Response) => {
  const orderNumber =
    typeof req.query.order_number === 'string' ? req.query.order_number.trim().toUpperCase() : '';
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';

  if (!orderNumber || !email) {
    res.status(400).json({ error: 'Order number and customer email are required.' });
    return;
  }

  const order = db
    .prepare(
      `SELECT id, order_number, customer_name, status, payment_method, payment_reference,
              subtotal, shipping_fee, total, created_at
       FROM orders
       WHERE UPPER(order_number) = ? AND LOWER(customer_email) = ?`
    )
    .get(orderNumber, email) as Record<string, unknown> | undefined;

  if (!order) {
    res.status(404).json({ error: 'No matching order found for that order number and email.' });
    return;
  }

  const items = db
    .prepare(
      `SELECT product_name, unit_price, quantity
       FROM order_items WHERE order_id = ?`
    )
    .all(order.id);

  res.json({ ...order, items });
});

// ============================================================================
// PROTECTED OWNER DASHBOARD ROUTES (/api/admin/*)
// ============================================================================

app.get('/api/admin/overview', requireOwner, (_req: Request, res: Response) => {
  const moneyInRow = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'in'")
    .get() as { total: number };
  const moneyOutRow = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'out'")
    .get() as { total: number };

  const savingsInRow = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM savings WHERE type IN ('deposit', 'auto')"
    )
    .get() as { total: number };
  const savingsOutRow = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM savings WHERE type = 'withdrawal'")
    .get() as { total: number };

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const ordersTodayRow = db
    .prepare('SELECT COUNT(*) as count FROM orders WHERE substr(created_at, 1, 10) = ?')
    .get(todayPrefix) as { count: number };

  const lowStockThreshold = Number(getSetting('low_stock_threshold', '5')) || 5;
  const lowStockProducts = db
    .prepare(
      `SELECT p.id, p.sku, p.name, p.stock, p.price, c.name as category_name
       FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE p.stock <= ?
       ORDER BY p.stock ASC`
    )
    .all(lowStockThreshold);

  const totalRevenue = Math.round(moneyInRow.total * 100) / 100;
  const totalExpenses = Math.round(moneyOutRow.total * 100) / 100;
  const netProfit = Math.round((totalRevenue - totalExpenses) * 100) / 100;
  const savingsBalance = Math.round((savingsInRow.total - savingsOutRow.total) * 100) / 100;

  // Revenue vs expenses series grouped by date (last 14 active days)
  const dailySeries = db
    .prepare(
      `SELECT date,
              COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE 0 END), 0) as revenue,
              COALESCE(SUM(CASE WHEN type = 'out' THEN amount ELSE 0 END), 0) as expenses
       FROM transactions
       GROUP BY date
       ORDER BY date ASC
       LIMIT 30`
    )
    .all();

  // Per-product sales insights (exclude Cancelled orders)
  const productInsights = db
    .prepare(
      `SELECT p.id, p.sku, p.name, p.price, p.cost_price, p.stock, p.image_url,
              c.name as category_name,
              COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN oi.quantity ELSE 0 END), 0) as units_sold,
              COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN oi.unit_price * oi.quantity ELSE 0 END), 0) as revenue,
              COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN (oi.unit_price - oi.unit_cost) * oi.quantity ELSE 0 END), 0) as profit
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN order_items oi ON oi.product_id = p.id
       LEFT JOIN orders o ON o.id = oi.order_id
       GROUP BY p.id
       ORDER BY revenue DESC, units_sold DESC`
    )
    .all();

  const ordersByStatus = db
    .prepare('SELECT status, COUNT(*) as count FROM orders GROUP BY status')
    .all();

  res.json({
    kpis: {
      totalRevenue,
      totalExpenses,
      netProfit,
      savingsBalance,
      savingsGoal: Number(getSetting('savings_goal', '5000')) || 5000,
      savingsPercentage: Number(getSetting('savings_percentage', '15')) || 15,
      ordersToday: ordersTodayRow.count,
      lowStockCount: lowStockProducts.length,
      lowStockThreshold,
    },
    lowStockProducts,
    dailySeries,
    productInsights,
    ordersByStatus,
    settings: {
      savings_goal: getSetting('savings_goal', '5000'),
      savings_percentage: getSetting('savings_percentage', '15'),
      low_stock_threshold: getSetting('low_stock_threshold', '5'),
      bank_account_info: getSetting('bank_account_info', ''),
      payment_gateway: getSetting('payment_gateway', 'manual'),
    },
  });
});

app.get('/api/admin/orders', requireOwner, (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (status && status !== 'All') {
    clauses.push('status = ?');
    params.push(status);
  }
  if (q) {
    clauses.push('(order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const orders = db
    .prepare(`SELECT * FROM orders ${whereSql} ORDER BY created_at DESC, id DESC`)
    .all(...params) as Array<Record<string, unknown>>;

  const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const enriched = orders.map((order) => ({
    ...order,
    items: getItems.all(order.id),
  }));

  res.json(enriched);
});

const VALID_ORDER_STATUSES = ['Pending', 'Paid', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

app.patch('/api/admin/orders/:id/status', requireOwner, (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const newStatus = typeof req.body?.status === 'string' ? req.body.status.trim() : '';

  if (!Number.isInteger(orderId) || !VALID_ORDER_STATUSES.includes(newStatus)) {
    res.status(400).json({ error: 'Invalid order ID or status.' });
    return;
  }

  try {
    const updated = db.transaction(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as
        | {
            id: number;
            order_number: string;
            customer_name: string;
            status: string;
            total: number;
            paid_recorded: number;
          }
        | undefined;

      if (!order) {
        return null;
      }

      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();

      // Restore stock if transitioning into Cancelled from a non-cancelled status
      if (newStatus === 'Cancelled' && order.status !== 'Cancelled') {
        const items = db
          .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
          .all(order.id) as Array<{ product_id: number; quantity: number }>;
        for (const item of items) {
          db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(
            item.quantity,
            item.product_id
          );
        }
      } else if (order.status === 'Cancelled' && newStatus !== 'Cancelled') {
        // Re-deduct stock if un-cancelling
        const items = db
          .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
          .all(order.id) as Array<{ product_id: number; quantity: number }>;
        for (const item of items) {
          db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?').run(
            item.quantity,
            item.product_id
          );
        }
      }

      // Automatically record income + auto-savings when marked Paid (idempotent via paid_recorded)
      let paidRecorded = order.paid_recorded;
      if (newStatus === 'Paid' && order.paid_recorded === 0) {
        paidRecorded = 1;
        db.prepare(
          `INSERT INTO transactions (type, amount, category, note, date, order_id, created_at)
           VALUES ('in', ?, 'Order Revenue', ?, ?, ?, ?)`
        ).run(
          order.total,
          `Order ${order.order_number} (${order.customer_name})`,
          today,
          order.id,
          now
        );

        const pct = Number(getSetting('savings_percentage', '15')) || 0;
        if (pct > 0) {
          const saveAmt = Math.round(((order.total * pct) / 100) * 100) / 100;
          if (saveAmt > 0) {
            db.prepare(
              `INSERT INTO savings (type, amount, note, order_id, date, created_at)
               VALUES ('auto', ?, ?, ?, ?, ?)`
            ).run(saveAmt, `${pct}% auto-set-aside from ${order.order_number}`, order.id, today, now);
          }
        }
      }

      db.prepare('UPDATE orders SET status = ?, paid_recorded = ? WHERE id = ?').run(
        newStatus,
        paidRecorded,
        order.id
      );

      const refreshed = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id) as Record<
        string,
        unknown
      >;
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      return { ...refreshed, items };
    })();

    if (!updated) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update order.' });
  }
});

app.get('/api/admin/orders/export', requireOwner, (_req: Request, res: Response) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all() as Array<{
    order_number: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    shipping_address: string;
    payment_method: string;
    status: string;
    subtotal: number;
    shipping_fee: number;
    total: number;
    created_at: string;
  }>;

  const header = [
    'Order Number',
    'Customer Name',
    'Email',
    'Phone',
    'Shipping Address',
    'Payment Method',
    'Status',
    'Subtotal',
    'Shipping Fee',
    'Total',
    'Created At',
  ].join(',');

  const lines = orders.map((o) =>
    [
      csvSafeCell(o.order_number),
      csvSafeCell(o.customer_name),
      csvSafeCell(o.customer_email),
      csvSafeCell(o.customer_phone),
      csvSafeCell(o.shipping_address),
      csvSafeCell(o.payment_method),
      csvSafeCell(o.status),
      csvSafeCell(o.subtotal.toFixed(2)),
      csvSafeCell(o.shipping_fee.toFixed(2)),
      csvSafeCell(o.total.toFixed(2)),
      csvSafeCell(o.created_at),
    ].join(',')
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sturex-orders.csv"');
  res.send([header, ...lines].join('\n'));
});

app.get('/api/admin/products', requireOwner, (_req: Request, res: Response) => {
  const rows = db
    .prepare(
      `SELECT p.*, c.name as category_name, c.slug as category_slug,
              COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN oi.quantity ELSE 0 END), 0) as units_sold,
              COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN oi.unit_price * oi.quantity ELSE 0 END), 0) as total_revenue,
              COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN (oi.unit_price - oi.unit_cost) * oi.quantity ELSE 0 END), 0) as total_profit
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN order_items oi ON oi.product_id = p.id
       LEFT JOIN orders o ON o.id = oi.order_id
       GROUP BY p.id
       ORDER BY p.id DESC`
    )
    .all();

  res.json(rows);
});

app.post('/api/admin/upload', requireOwner, (req: Request, res: Response) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Image upload failed.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No image file provided.' });
      return;
    }
    // Verify resolved path stays strictly inside UPLOAD_DIR
    const resolved = path.resolve(req.file.path);
    if (!resolved.startsWith(UPLOAD_DIR + path.sep)) {
      fs.unlinkSync(resolved);
      res.status(400).json({ error: 'Invalid upload path.' });
      return;
    }
    res.status(201).json({ imageUrl: `/uploads/${req.file.filename}` });
  });
});

function validateProductPayload(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const sku = typeof body.sku === 'string' ? body.sku.trim().toUpperCase() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const categoryId = Number(body.category_id);
  const price = Number(body.price);
  const costPrice = Number(body.cost_price);
  const stock = Number(body.stock);
  const imageUrl = typeof body.image_url === 'string' ? body.image_url.trim() : '';
  const featured = body.featured ? 1 : 0;

  if (name.length < 2) return { error: 'Product name is required.' };
  if (sku.length < 2) return { error: 'Product SKU is required.' };
  if (description.length < 5) return { error: 'Description is required.' };
  if (!Number.isInteger(categoryId) || categoryId < 1) return { error: 'Valid category is required.' };
  if (!Number.isFinite(price) || price <= 0) return { error: 'Selling price must be greater than 0.' };
  if (!Number.isFinite(costPrice) || costPrice < 0) return { error: 'Cost price cannot be negative.' };
  if (!Number.isInteger(stock) || stock < 0) return { error: 'Stock must be a non-negative integer.' };

  // Block unsafe URL schemes in image_url
  if (
    !imageUrl ||
    (!imageUrl.startsWith('/') &&
      !imageUrl.startsWith('https://') &&
      !imageUrl.startsWith('http://'))
  ) {
    return { error: 'Please provide a valid image upload or http(s) URL.' };
  }

  return {
    data: {
      name,
      sku,
      slug: `${slugify(name)}-${crypto.randomBytes(2).toString('hex')}`,
      description,
      categoryId,
      price: Math.round(price * 100) / 100,
      costPrice: Math.round(costPrice * 100) / 100,
      stock,
      imageUrl,
      featured,
    },
  };
}

app.post('/api/admin/products', requireOwner, (req: Request, res: Response) => {
  const validated = validateProductPayload(req.body || {});
  if ('error' in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const d = validated.data;
  try {
    const info = db
      .prepare(
        `INSERT INTO products (sku, name, slug, description, category_id, price, cost_price, stock, image_url, featured, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        d.sku,
        d.name,
        d.slug,
        d.description,
        d.categoryId,
        d.price,
        d.costPrice,
        d.stock,
        d.imageUrl,
        d.featured,
        new Date().toISOString()
      );
    const created = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error && err.message.includes('UNIQUE')
          ? 'A product with that SKU already exists.'
          : 'Unable to create product.',
    });
  }
});

app.put('/api/admin/products/:id', requireOwner, (req: Request, res: Response) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId)) {
    res.status(400).json({ error: 'Invalid product ID.' });
    return;
  }

  const existing = db.prepare('SELECT id, slug FROM products WHERE id = ?').get(productId) as
    | { id: number; slug: string }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  const validated = validateProductPayload(req.body || {});
  if ('error' in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const d = validated.data;

  try {
    db.prepare(
      `UPDATE products
       SET sku = ?, name = ?, description = ?, category_id = ?, price = ?, cost_price = ?, stock = ?, image_url = ?, featured = ?
       WHERE id = ?`
    ).run(
      d.sku,
      d.name,
      d.description,
      d.categoryId,
      d.price,
      d.costPrice,
      d.stock,
      d.imageUrl,
      d.featured,
      productId
    );
    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    res.json(updated);
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error && err.message.includes('UNIQUE')
          ? 'SKU already belongs to another product.'
          : 'Unable to update product.',
    });
  }
});

app.delete('/api/admin/products/:id', requireOwner, (req: Request, res: Response) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId)) {
    res.status(400).json({ error: 'Invalid product ID.' });
    return;
  }

  const referenced = db
    .prepare('SELECT COUNT(*) as count FROM order_items WHERE product_id = ?')
    .get(productId) as { count: number };

  if (referenced.count > 0) {
    res.status(400).json({
      error: 'Cannot delete a product that has historical order records. Set stock to 0 instead.',
    });
    return;
  }

  const result = db.prepare('DELETE FROM products WHERE id = ?').run(productId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  res.json({ ok: true });
});

// ============================================================================
// MONEY LEDGER & SAVINGS ROUTES
// ============================================================================

app.get('/api/admin/ledger', requireOwner, (req: Request, res: Response) => {
  const type = typeof req.query.type === 'string' ? req.query.type : '';
  const category = typeof req.query.category === 'string' ? req.query.category : '';

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (type === 'in' || type === 'out') {
    clauses.push('type = ?');
    params.push(type);
  }
  if (category && category !== 'All') {
    clauses.push('category = ?');
    params.push(category);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM transactions ${whereSql} ORDER BY date DESC, id DESC`)
    .all(...params);
  res.json(rows);
});

app.post('/api/admin/ledger', requireOwner, (req: Request, res: Response) => {
  const { type, amount, category, date, note } = req.body || {};
  const cleanType = type === 'in' ? 'in' : 'out';
  const numAmount = Number(amount);
  const cleanCategory = typeof category === 'string' && category.trim() ? category.trim() : 'Other';
  const cleanDate =
    typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : new Date().toISOString().slice(0, 10);
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 240) : '';

  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    res.status(400).json({ error: 'Amount must be greater than zero.' });
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO transactions (type, amount, category, note, date, order_id, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(
      cleanType,
      Math.round(numAmount * 100) / 100,
      cleanCategory,
      cleanNote,
      cleanDate,
      new Date().toISOString()
    );

  const created = db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

app.delete('/api/admin/ledger/:id', requireOwner, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid transaction ID.' });
    return;
  }
  const tx = db.prepare('SELECT order_id FROM transactions WHERE id = ?').get(id) as
    | { order_id: number | null }
    | undefined;
  if (!tx) {
    res.status(404).json({ error: 'Transaction not found.' });
    return;
  }
  if (tx.order_id !== null) {
    res.status(400).json({ error: 'Automatic order revenue transactions cannot be deleted.' });
    return;
  }
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/admin/ledger/export', requireOwner, (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC').all() as Array<{
    id: number;
    date: string;
    type: string;
    category: string;
    amount: number;
    note: string;
    order_id: number | null;
  }>;

  const header = ['ID', 'Date', 'Type', 'Category', 'Amount', 'Note', 'Order ID'].join(',');
  const lines = rows.map((r) =>
    [
      csvSafeCell(r.id),
      csvSafeCell(r.date),
      csvSafeCell(r.type === 'in' ? 'Money In' : 'Money Out'),
      csvSafeCell(r.category),
      csvSafeCell(r.amount.toFixed(2)),
      csvSafeCell(r.note),
      csvSafeCell(r.order_id ?? ''),
    ].join(',')
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sturex-ledger.csv"');
  res.send([header, ...lines].join('\n'));
});

app.get('/api/admin/savings', requireOwner, (_req: Request, res: Response) => {
  const savingsInRow = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM savings WHERE type IN ('deposit', 'auto')"
    )
    .get() as { total: number };
  const savingsOutRow = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM savings WHERE type = 'withdrawal'")
    .get() as { total: number };
  const history = db.prepare('SELECT * FROM savings ORDER BY date DESC, id DESC').all();

  res.json({
    balance: Math.round((savingsInRow.total - savingsOutRow.total) * 100) / 100,
    goal: Number(getSetting('savings_goal', '5000')) || 5000,
    percentage: Number(getSetting('savings_percentage', '15')) || 15,
    history,
  });
});

app.post('/api/admin/savings', requireOwner, (req: Request, res: Response) => {
  const { type, amount, note, date } = req.body || {};
  const cleanType = type === 'withdrawal' ? 'withdrawal' : 'deposit';
  const numAmount = Number(amount);
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 200) : '';
  const cleanDate =
    typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : new Date().toISOString().slice(0, 10);

  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    res.status(400).json({ error: 'Amount must be greater than zero.' });
    return;
  }

  if (cleanType === 'withdrawal') {
    const inRow = db
      .prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM savings WHERE type IN ('deposit', 'auto')"
      )
      .get() as { total: number };
    const outRow = db
      .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM savings WHERE type = 'withdrawal'")
      .get() as { total: number };
    const currentBal = inRow.total - outRow.total;
    if (numAmount > currentBal) {
      res.status(400).json({ error: 'Withdrawal amount exceeds current savings balance.' });
      return;
    }
  }

  const info = db
    .prepare(
      `INSERT INTO savings (type, amount, note, order_id, date, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`
    )
    .run(
      cleanType,
      Math.round(numAmount * 100) / 100,
      cleanNote || (cleanType === 'deposit' ? 'Manual deposit' : 'Manual withdrawal'),
      cleanDate,
      new Date().toISOString()
    );

  const created = db.prepare('SELECT * FROM savings WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

app.put('/api/admin/settings', requireOwner, (req: Request, res: Response) => {
  const { savings_goal, savings_percentage, low_stock_threshold, bank_account_info } =
    req.body || {};

  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  if (savings_goal !== undefined) {
    const g = Number(savings_goal);
    if (!Number.isFinite(g) || g <= 0) {
      res.status(400).json({ error: 'Savings goal must be greater than 0.' });
      return;
    }
    upsert.run('savings_goal', String(Math.round(g * 100) / 100));
  }
  if (savings_percentage !== undefined) {
    const p = Number(savings_percentage);
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      res.status(400).json({ error: 'Savings percentage must be between 0 and 100.' });
      return;
    }
    upsert.run('savings_percentage', String(Math.round(p * 100) / 100));
  }
  if (low_stock_threshold !== undefined) {
    const t = Number(low_stock_threshold);
    if (!Number.isInteger(t) || t < 0) {
      res.status(400).json({ error: 'Low stock threshold must be a non-negative integer.' });
      return;
    }
    upsert.run('low_stock_threshold', String(t));
  }
  if (typeof bank_account_info === 'string') {
    upsert.run('bank_account_info', bank_account_info.trim().slice(0, 200));
  }

  res.json({ ok: true });
});

// ============================================================================
// VITE / STATIC SERVING
// ============================================================================

async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sturex server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
