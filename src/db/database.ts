import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';

const DB_PATH = path.resolve(process.cwd(), 'sturex.db');
const db = new Database(DB_PATH);

// Enable WAL mode and foreign key constraints for integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialize all 8 core Sturex tables plus server-side sessions table.
 */
export function initSchema(): void {
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

/**
 * Hash a password using Node's native scrypt with a 16-byte random salt.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

/**
 * Verify a plaintext password against a stored scrypt hash in constant time.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, originalHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

/**
 * Seed initial categories, 12 curated studio products, sample orders,
 * financial ledger transactions, savings records, and default store settings.
 * Safe to call repeatedly (idempotent).
 */
export function seedInitialCatalogIfEmpty(): void {
  const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };

  // Default store settings
  const defaultSettings: Record<string, string> = {
    savings_goal: '5000',
    savings_percentage: '15',
    low_stock_threshold: '5',
    store_currency: 'USD',
    payment_gateway: 'manual',
    bank_account_info: 'Sturex Studio LLC · Routing 021000021 · Acct 8841-9024-11',
  };
  const upsertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  for (const [k, v] of Object.entries(defaultSettings)) {
    upsertSetting.run(k, v);
  }

  // Optional env-configured initial owner account
  if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim().length >= 8) {
    const email = (process.env.ADMIN_EMAIL || 'owner@sturex.store').trim().toLowerCase();
    const existingOwner = db.prepare('SELECT id FROM users LIMIT 1').get();
    if (!existingOwner) {
      db.prepare(
        'INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)'
      ).run(email, hashPassword(process.env.ADMIN_PASSWORD.trim()), 'Sturex Owner', new Date().toISOString());
    }
  }

  if (productCount.count > 0) return;

  const seedTx = db.transaction(() => {
    const categories = [
      { name: 'Desk Hardware', slug: 'desk-hardware', description: 'Precision CNC-machined tools and tactile desktop instruments.' },
      { name: 'Lighting', slug: 'lighting', description: 'Architectural task and ambient lighting in brushed metals.' },
      { name: 'Carry & Leather', slug: 'carry-leather', description: 'Vegetable-tanned leather folios, waxed canvas, and travel essentials.' },
      { name: 'Audio & Living', slug: 'audio-living', description: 'Minimalist studio acoustics, stoneware vessels, and desk objects.' },
    ];

    const insertCat = db.prepare(
      'INSERT OR IGNORE INTO categories (name, slug, description) VALUES (?, ?, ?)'
    );
    for (const c of categories) {
      insertCat.run(c.name, c.slug, c.description);
    }

    const catRows = db.prepare('SELECT id, slug FROM categories').all() as Array<{ id: number; slug: string }>;
    const catMap = Object.fromEntries(catRows.map((c) => [c.slug, c.id]));

    const now = new Date().toISOString();
    const products = [
      {
        sku: 'STX-LMP-01',
        name: 'Aether Task Lamp',
        slug: 'aether-task-lamp',
        description: 'CNC-extruded brushed anodized aluminum cantilever desk lamp with stepless warm-to-daylight dimming (2700K–4500K) and weighted steel base.',
        category_id: catMap['lighting'],
        price: 245.0,
        cost_price: 105.0,
        stock: 14,
        image_url: '/src/assets/images/prod_aether_lamp_1795599005333.jpg',
        featured: 1,
      },
      {
        sku: 'STX-DCK-02',
        name: 'Monolith Mag Dock',
        slug: 'monolith-mag-dock',
        description: 'Solid bead-blasted matte black 6061 aluminum 15W magnetic wireless charging stand angled at 62 degrees for effortless desk glanceability.',
        category_id: catMap['desk-hardware'],
        price: 118.0,
        cost_price: 46.0,
        stock: 22,
        image_url: '/src/assets/images/prod_monolith_dock_1795599005618.jpg',
        featured: 1,
      },
      {
        sku: 'STX-KRO-03',
        name: 'Kuro Ceramic Pour-Over',
        slug: 'kuro-ceramic-pour-over',
        description: 'Hand-thrown matte black stoneware dripper and double-walled carafe with integrated borosilicate brew window for studio morning rituals.',
        category_id: catMap['audio-living'],
        price: 94.0,
        cost_price: 38.0,
        stock: 18,
        image_url: '/src/assets/images/prod_kuro_pourover_1795599006407.jpg',
        featured: 1,
      },
      {
        sku: 'STX-KBD-04',
        name: 'Sora 65 Mechanical Keyboard',
        slug: 'sora-65-mechanical-keyboard',
        description: 'Gasket-mounted silver anodized 65% mechanical keyboard with PBT charcoal keycaps, hot-swappable tactile switches, and a knurled solid brass encoder.',
        category_id: catMap['desk-hardware'],
        price: 289.0,
        cost_price: 132.0,
        stock: 9,
        image_url: '/src/assets/images/prod_sora_keyboard_1795599006365.jpg',
        featured: 1,
      },
      {
        sku: 'STX-LTH-05',
        name: 'Vesper Leather Folio',
        slug: 'vesper-leather-folio',
        description: 'Full-grain Italian vegetable-tanned cognac leather laptop sleeve lined with soft microfiber and secured by solid brass post studs.',
        category_id: catMap['carry-leather'],
        price: 165.0,
        cost_price: 68.0,
        stock: 4,
        image_url: '/src/assets/images/prod_vesper_folio_1795599006905.jpg',
        featured: 0,
      },
      {
        sku: 'STX-AUD-06',
        name: 'Pulse Field Speaker',
        slug: 'pulse-field-speaker',
        description: 'Reference-tuned portable studio monitor wrapped in brushed aluminum and woven acoustic wool with 18-hour USB-C battery life.',
        category_id: catMap['audio-living'],
        price: 320.0,
        cost_price: 148.0,
        stock: 7,
        image_url: '/src/assets/images/prod_pulse_speaker_1795599007305.jpg',
        featured: 1,
      },
      {
        sku: 'STX-LMP-07',
        name: 'Lumen Orbital Light',
        slug: 'lumen-orbital-light',
        description: 'Hand-blown opal glass diffuser cradled inside an angled brushed brass ring on a matte mineral plinth. Emits warm 2400K ambient glow.',
        category_id: catMap['lighting'],
        price: 210.0,
        cost_price: 89.0,
        stock: 11,
        image_url: '/src/assets/images/prod_lumen_light_1795599007483.jpg',
        featured: 0,
      },
      {
        sku: 'STX-MAT-08',
        name: 'Merino Studio Mat',
        slug: 'merino-studio-mat',
        description: '4mm dense German merino wool felt workspace mat finished with hand-stitched saddle leather edge trim and travel snap strap.',
        category_id: catMap['desk-hardware'],
        price: 88.0,
        cost_price: 31.0,
        stock: 26,
        image_url: '/src/assets/images/prod_merino_mat_1795599007948.jpg',
        featured: 0,
      },
      {
        sku: 'STX-FLK-09',
        name: 'Nomad Titanium Flask',
        slug: 'nomad-titanium-flask',
        description: 'Double-wall vacuum-insulated Grade 1 titanium 500ml bottle with diamond-knurled screw cap and zero metallic aftertaste.',
        category_id: catMap['carry-leather'],
        price: 76.0,
        cost_price: 29.0,
        stock: 19,
        image_url: '/src/assets/images/prod_nomad_flask_1795599009374.jpg',
        featured: 0,
      },
      {
        sku: 'STX-PEN-10',
        name: 'Arc Brass Pen & Stand',
        slug: 'arc-brass-pen-stand',
        description: 'Precision-turned C36000 solid brass rollerball pen with diamond-knurled grip, Schmidt P8126 refill, and angled anodized aluminum cradle.',
        category_id: catMap['desk-hardware'],
        price: 92.0,
        cost_price: 34.0,
        stock: 3,
        image_url: '/src/assets/images/prod_arc_pen_1795599009183.jpg',
        featured: 0,
      },
      {
        sku: 'STX-TRY-11',
        name: 'Forma Fluted Valet Tray',
        slug: 'forma-fluted-valet-tray',
        description: 'Slip-cast matte limestone ceramic catchall tray with architectural fluting for everyday keys, watches, and studio instruments.',
        category_id: catMap['audio-living'],
        price: 54.0,
        cost_price: 18.0,
        stock: 31,
        image_url: '/src/assets/images/prod_forma_tray_1795599009195.jpg',
        featured: 0,
      },
      {
        sku: 'STX-BAG-12',
        name: 'Drift Canvas Weekender',
        slug: 'drift-canvas-weekender',
        description: '18oz Scottish waxed cotton canvas duffle reinforced with English bridle leather handles, matte black steel hardware, and padded 16" laptop compartment.',
        category_id: catMap['carry-leather'],
        price: 275.0,
        cost_price: 118.0,
        stock: 6,
        image_url: '/src/assets/images/prod_drift_weekender_1795599009527.jpg',
        featured: 1,
      },
    ];

    const insertProd = db.prepare(`
      INSERT INTO products (sku, name, slug, description, category_id, price, cost_price, stock, image_url, featured, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const productIds: Record<string, number> = {};
    for (const p of products) {
      const info = insertProd.run(
        p.sku,
        p.name,
        p.slug,
        p.description,
        p.category_id,
        p.price,
        p.cost_price,
        p.stock,
        p.image_url,
        p.featured,
        now
      );
      productIds[p.sku] = Number(info.lastInsertRowid);
    }

    // Seed sample historical orders over the last 3 weeks + today
    const daysAgo = (d: number) => {
      const dt = new Date();
      dt.setDate(dt.getDate() - d);
      return dt.toISOString();
    };
    const dateOnly = (iso: string) => iso.slice(0, 10);

    const sampleOrders = [
      {
        order_number: 'STX-1038',
        customer_name: 'Elena Vance',
        customer_email: 'elena.vance@example.com',
        customer_phone: '+1 (415) 555-0192',
        shipping_address: '412 Mercer St, Apt 4B, Seattle, WA 98109',
        payment_method: 'bank_transfer',
        status: 'Delivered',
        paid_recorded: 1,
        created_at: daysAgo(18),
        items: [
          { sku: 'STX-LMP-01', name: 'Aether Task Lamp', price: 245, cost: 105, qty: 1 },
          { sku: 'STX-MAT-08', name: 'Merino Studio Mat', price: 88, cost: 31, qty: 1 },
        ],
      },
      {
        order_number: 'STX-1039',
        customer_name: 'Marcus Thorne',
        customer_email: 'm.thorne@example.com',
        customer_phone: '+1 (312) 555-0148',
        shipping_address: '890 W Fulton Market, Chicago, IL 60607',
        payment_method: 'bank_transfer',
        status: 'Delivered',
        paid_recorded: 1,
        created_at: daysAgo(12),
        items: [
          { sku: 'STX-KBD-04', name: 'Sora 65 Mechanical Keyboard', price: 289, cost: 132, qty: 1 },
          { sku: 'STX-PEN-10', name: 'Arc Brass Pen & Stand', price: 92, cost: 34, qty: 1 },
        ],
      },
      {
        order_number: 'STX-1040',
        customer_name: 'Nadia Okafor',
        customer_email: 'nadia@studio-okafor.com',
        customer_phone: '+1 (646) 555-0183',
        shipping_address: '214 Wythe Ave, Brooklyn, NY 11249',
        payment_method: 'pay_on_delivery',
        status: 'Shipped',
        paid_recorded: 1,
        created_at: daysAgo(6),
        items: [
          { sku: 'STX-AUD-06', name: 'Pulse Field Speaker', price: 320, cost: 148, qty: 1 },
          { sku: 'STX-TRY-11', name: 'Forma Fluted Valet Tray', price: 54, cost: 18, qty: 2 },
        ],
      },
      {
        order_number: 'STX-1041',
        customer_name: 'Daniel Lindqvist',
        customer_email: 'daniel.l@example.com',
        customer_phone: '+1 (512) 555-0124',
        shipping_address: '1204 S Congress Ave, Austin, TX 78704',
        payment_method: 'bank_transfer',
        status: 'Paid',
        paid_recorded: 1,
        created_at: daysAgo(2),
        items: [
          { sku: 'STX-BAG-12', name: 'Drift Canvas Weekender', price: 275, cost: 118, qty: 1 },
          { sku: 'STX-FLK-09', name: 'Nomad Titanium Flask', price: 76, cost: 29, qty: 1 },
        ],
      },
      {
        order_number: 'STX-1042',
        customer_name: 'Clara Chen',
        customer_email: 'clara.chen@example.com',
        customer_phone: '+1 (213) 555-0167',
        shipping_address: '742 Mateo St, Los Angeles, CA 90021',
        payment_method: 'pay_on_delivery',
        status: 'Pending',
        paid_recorded: 0,
        created_at: daysAgo(0),
        items: [
          { sku: 'STX-DCK-02', name: 'Monolith Mag Dock', price: 118, cost: 46, qty: 1 },
          { sku: 'STX-KRO-03', name: 'Kuro Ceramic Pour-Over', price: 94, cost: 38, qty: 1 },
        ],
      },
    ];

    const insertOrder = db.prepare(`
      INSERT INTO orders (order_number, customer_name, customer_email, customer_phone, shipping_address, payment_method, payment_reference, status, subtotal, shipping_fee, total, paid_recorded, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, unit_cost, quantity)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertTx = db.prepare(`
      INSERT INTO transactions (type, amount, category, note, date, order_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSav = db.prepare(`
      INSERT INTO savings (type, amount, note, order_id, date, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const o of sampleOrders) {
      const subtotal = o.items.reduce((acc, i) => acc + i.price * i.qty, 0);
      const shipping = subtotal >= 150 ? 0 : 12;
      const total = subtotal + shipping;
      const res = insertOrder.run(
        o.order_number,
        o.customer_name,
        o.customer_email,
        o.customer_phone,
        o.shipping_address,
        o.payment_method,
        `REF-${o.order_number}`,
        o.status,
        subtotal,
        shipping,
        total,
        o.paid_recorded,
        o.created_at
      );
      const orderId = Number(res.lastInsertRowid);

      for (const item of o.items) {
        insertItem.run(orderId, productIds[item.sku], item.name, item.price, item.cost, item.qty);
      }

      if (o.paid_recorded === 1) {
        insertTx.run(
          'in',
          total,
          'Order Revenue',
          `Order ${o.order_number} (${o.customer_name})`,
          dateOnly(o.created_at),
          orderId,
          o.created_at
        );
        const saveAmt = Math.round(total * 0.15 * 100) / 100;
        insertSav.run(
          'auto',
          saveAmt,
          `15% auto-set-aside from ${o.order_number}`,
          orderId,
          dateOnly(o.created_at),
          o.created_at
        );
      }
    }

    // Sample manual operating expenses
    const expenses = [
      { amount: 420.0, category: 'Restock', note: 'Batch restock: Merino mats & ceramic trays', date: dateOnly(daysAgo(16)) },
      { amount: 95.5, category: 'Delivery', note: 'Courier fulfillment & protective packaging', date: dateOnly(daysAgo(10)) },
      { amount: 145.0, category: 'Ads', note: 'Architectural Digest digital placement', date: dateOnly(daysAgo(4)) },
    ];
    for (const e of expenses) {
      insertTx.run('out', e.amount, e.category, e.note, e.date, null, now);
    }

    // Initial manual savings deposit
    insertSav.run('deposit', 500.0, 'Initial studio reserve seed', null, dateOnly(daysAgo(20)), daysAgo(20));
  });

  seedTx();
}

export default db;
