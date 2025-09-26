
// Snakz Plug API server
// Implements /api/store, /api/products, /api/orders, /api/auth per spec
// Env vars: DATABASE_URL, JWT_SECRET, ADMIN_API_KEY (optional)
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(helmet());
app.use(bodyParser.json());
app.use(cookieParser());

// CORS - allow credentials
app.use(cors({ origin: true, credentials: true }));

const connectionString = process.env.DATABASE_URL || process.env.PG_CONNECTION || '';
const pool = new Pool({ connectionString, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

const JWT_SECRET = process.env.JWT_SECRET || 'please_change_me';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

// Initialize DB tables
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      name TEXT,
      settings JSONB,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      price NUMERIC,
      versions JSONB,
      flavors JSONB,
      stock_qty INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      payload JSONB,
      payment_type TEXT,
      payment_ref TEXT,
      status TEXT,
      customer_name TEXT,
      created_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT,
      version_key TEXT,
      flavor_key TEXT,
      qty INTEGER,
      unit_price NUMERIC,
      meta JSONB
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_events (
      id SERIAL PRIMARY KEY,
      product_id TEXT,
      change_qty INTEGER,
      reason TEXT,
      meta JSONB,
      created_at TIMESTAMP DEFAULT now()
    );
  `);
  // create a single default store row if not exists
  const r = await pool.query(`SELECT id FROM stores LIMIT 1`);
  if (r.rowCount === 0) {
    const defaultSettings = {
      owner_pass_hash: await bcrypt.hash('admin123', 10),
      store_name: 'Snakz Plug',
      cash_app_handle: '',
      venmo_handle: '',
      pickup_instructions: 'Pick up at the student booth.',
      hide_when_zero: true
    };
    await pool.query(`INSERT INTO stores (id, name, settings) VALUES ($1,$2,$3)`, ['default','Snakz Plug', defaultSettings]);
  }
}
initDb().catch(e=>console.error("DB init error", e));

// Helper auth middleware
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.status(401).json({ ok:false, error: 'auth required' });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) {
    return res.status(401).json({ ok:false, error: 'invalid token' });
  }
}

// Utility: safe settings copy without owner_pass_hash
function filterSettings(settings) {
  const out = Object.assign({}, settings);
  if (out.owner_pass_hash) delete out.owner_pass_hash;
  return out;
}

// --- Store endpoints ---
// GET /api/store (public) -> return store settings (excluding password hash)
app.get('/api/store', async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, name, settings FROM stores LIMIT 1`);
    if (r.rowCount === 0) return res.json({ ok:true, store: null });
    const row = r.rows[0];
    const settings = filterSettings(row.settings || {});
    res.json({ ok:true, store: { id: row.id, name: row.name, settings } });
  } catch(e) { console.error(e); res.status(500).json({ ok:false, error: 'server error' }); }
});

// PATCH /api/store (admin only) -> update settings
app.patch('/api/store', requireAuth, async (req, res) => {
  try {
    const updates = req.body || {};
    // if owner_pass present, hash it and store as owner_pass_hash
    const cur = await pool.query(`SELECT settings FROM stores LIMIT 1`);
    if (cur.rowCount === 0) return res.status(400).json({ ok:false, error: 'no store' });
    const settings = Object.assign({}, cur.rows[0].settings || {});
    if (typeof updates.owner_pass !== 'undefined') {
      settings.owner_pass_hash = await bcrypt.hash(String(updates.owner_pass), 10);
      delete updates.owner_pass;
    }
    // merge other updates into settings
    for (const k of Object.keys(updates || {})) settings[k] = updates[k];
    await pool.query(`UPDATE stores SET settings=$1, updated_at=now() WHERE id = (SELECT id FROM stores LIMIT 1)`, [settings]);
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error: 'server error' }); }
});

// --- Auth endpoints ---
app.post('/api/auth/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ ok:false, error: 'password required' });
    const r = await pool.query(`SELECT settings FROM stores LIMIT 1`);
    if (r.rowCount === 0) return res.status(400).json({ ok:false, error: 'no store' });
    const settings = r.rows[0].settings || {};
    const hash = settings.owner_pass_hash;
    if (!hash) return res.status(400).json({ ok:false, error: 'no password set' });
    const ok = await bcrypt.compare(String(password), hash);
    if (!ok) return res.status(401).json({ ok:false, error: 'wrong password' });
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error: 'server error' }); }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok:true });
});

app.get('/api/auth/me', (req, res) => {
  try {
    const token = req.cookies && req.cookies.token;
    if (!token) return res.json({ ok:false, loggedIn:false });
    jwt.verify(token, JWT_SECRET);
    return res.json({ ok:true, loggedIn:true });
  } catch(e) { return res.json({ ok:false, loggedIn:false }); }
});

// --- Products endpoints ---
// GET /api/products -> list active products
app.get('/api/products', async (req, res) => {
  try {
    const r = await pool.query(`SELECT id,name,description,price,versions,flavors,stock_qty,is_active,image_url,created_at,updated_at FROM products WHERE is_active=TRUE ORDER BY name`);
    res.json({ ok:true, products: r.rows });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error: 'server error' }); }
});

// GET /api/products/all -> admin only
app.get('/api/products/all', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM products ORDER BY created_at DESC`);
    res.json({ ok:true, products: r.rows });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error: 'server error' }); }
});

// POST /api/products -> add (admin only)
app.post('/api/products', requireAuth, async (req, res) => {
  try {
    const p = req.body || {};
    if (!p.id) p.id = (p.name || 'prod').toLowerCase().replace(/\s+/g,'-') + '-' + Math.floor(Math.random()*9000+1000);
    await pool.query(`INSERT INTO products (id,name,description,price,versions,flavors,stock_qty,is_active,image_url,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`, [p.id,p.name||'',p.description||'',p.price||0, p.versions||null, p.flavors||null, p.stock_qty||0, p.is_active!==false, p.image_url||null]);
    res.json({ ok:true, product_id: p.id });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error: 'server error' }); }
});

// PATCH /api/products/:id -> edit or change stock (admin)
app.patch('/api/products/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  const updates = req.body || {};
  // if stock change provided, do transaction: SELECT FOR UPDATE, update stock, insert inventory_event
  if (typeof updates.stock_qty !== 'undefined') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT stock_qty FROM products WHERE id=$1 FOR UPDATE', [id]);
      if (cur.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ ok:false, error: 'product not found' }); }
      const oldStock = Number(cur.rows[0].stock_qty || 0);
      const newStock = Number(updates.stock_qty);
      const diff = newStock - oldStock;
      await client.query('UPDATE products SET stock_qty=$1, updated_at=now() WHERE id=$2', [newStock, id]);
      await client.query('INSERT INTO inventory_events (product_id, change_qty, reason, meta) VALUES ($1,$2,$3,$4)', [id, diff, 'manual_adjust', updates.meta || null]);
      await client.query('COMMIT');
      return res.json({ ok:true });
    } catch(e){ try { await client.query('ROLLBACK'); } catch(err){} console.error(e); return res.status(500).json({ ok:false, error: 'server error' }); } finally { client.release(); }
  } else {
    // general updates
    const allowed = ['name','description','price','versions','flavors','is_active','image_url'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const k of allowed) {
      if (typeof updates[k] !== 'undefined') {
        sets.push(k + ' = $' + i);
        vals.push(updates[k]);
        i++;
      }
    }
    if (sets.length === 0) return res.json({ ok:true });
    vals.push(id);
    try {
      await pool.query(`UPDATE products SET ${sets.join(',')}, updated_at=now() WHERE id=$${i}`, vals);
      return res.json({ ok:true });
    } catch(e){ console.error(e); res.status(500).json({ ok:false, error: 'server error' }); }
  }
});

// DELETE product (admin) optional
app.delete('/api/products/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    await pool.query('DELETE FROM products WHERE id=$1', [id]);
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error: 'server error' }); }
});

// --- Orders ---
// POST /api/orders -> create order (transactional)
app.post('/api/orders', async (req, res) => {
  const client = await pool.connect();
  try {
    const { cart, subtotal, payment_type, payment_ref, customer_name, currency } = req.body;
    if (!Array.isArray(cart) || cart.length === 0) return res.status(400).json({ ok:false, error: 'cart required' });
    const id = uuidv4();
    const status = payment_type === 'cash' ? 'paid' : 'pending';
    await client.query('BEGIN');
    // for each cart item, lock product and decrement
    for (const item of cart) {
      const prodId = item.product_id || item.id || (item.product && item.product.id);
      const qty = Number(item.qty || item.quantity || 0);
      if (!prodId) { await client.query('ROLLBACK'); return res.status(400).json({ ok:false, error: 'invalid cart item' }); }
      const p = await client.query('SELECT stock_qty FROM products WHERE id=$1 FOR UPDATE', [prodId]);
      if (p.rowCount === 0) { await client.query('ROLLBACK'); return res.status(400).json({ ok:false, error: `Product not found: ${prodId}` }); }
      const stock = Number(p.rows[0].stock_qty || 0);
      if (stock < qty) { await client.query('ROLLBACK'); return res.status(400).json({ ok:false, error: `Not enough stock for ${prodId}` }); }
      const newStock = stock - qty;
      await client.query('UPDATE products SET stock_qty=$1, updated_at=now() WHERE id=$2', [newStock, prodId]);
      await client.query('INSERT INTO inventory_events (product_id, change_qty, reason, meta) VALUES ($1,$2,$3,$4)', [prodId, -qty, 'sale', { order_id: id, item }]);
      await client.query('INSERT INTO order_items (order_id, product_id, version_key, flavor_key, qty, unit_price, meta) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, prodId, item.version_key || null, item.flavor_key || null, qty, item.price || (item.unit_price||0), item]);
    }
    await client.query('INSERT INTO orders (id, payload, payment_type, payment_ref, status, customer_name, created_at) VALUES ($1,$2,$3,$4,$5,$6,now())', [id, { cart, subtotal, currency: currency || 'USD' }, payment_type, payment_ref || null, status, customer_name || null]);
    await client.query('COMMIT');
    res.json({ ok:true, order_id: id });
  } catch(e) {
    try { await client.query('ROLLBACK'); } catch(err) {}
    console.error('Order error', e);
    res.status(500).json({ ok:false, error: 'server error' });
  } finally {
    client.release();
  }
});

// GET /api/orders (admin) list orders with aggregated items
app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT o.*, COALESCE(json_agg(oi.*) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 500
    `);
    res.json({ ok:true, orders: r.rows });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error: 'server error' }); }
});

// PATCH /api/orders/:id -> update order status (admin)
app.patch('/api/orders/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body || {};
    const allowed = ['status', 'payment_ref', 'customer_name'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const k of allowed) {
      if (typeof updates[k] !== 'undefined') {
        sets.push(k + ' = $' + i);
        vals.push(updates[k]);
        i++;
      }
    }
    if (sets.length === 0) return res.json({ ok:true });
    vals.push(id);
    await pool.query(`UPDATE orders SET ${sets.join(',')} WHERE id=$${i}`, vals);
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error: 'server error' }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, ()=> console.log('API listening on', PORT));
