
// Candy PWA - API server (updated)
// Usage: set environment variables:
//   DATABASE_URL (Postgres connection string)
//   JWT_SECRET (secret for signing admin session cookies)
//   ADMIN_API_KEY (optional: additional admin key for automation)
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
app.use(helmet());
app.use(bodyParser.json());
app.use(cookieParser());

// Allow CORS from any origin and allow credentials (cookies)
// In production, set origin to your frontend URL.
app.use(cors({ origin: true, credentials: true }));

const connectionString = process.env.DATABASE_URL || process.env.POSTGRESQL_URI || process.env.PG_CONNECTION || '';
if (!connectionString) {
  console.error("No DATABASE_URL / POSTGRESQL_URI provided. Set the env var and restart.");
  // continue - server will error when trying to connect
}
const pool = new Pool({ connectionString, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

const JWT_SECRET = process.env.JWT_SECRET || 'please_change_this_secret';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

// initialize tables
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
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
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      method TEXT,
      amount NUMERIC,
      currency TEXT,
      reference TEXT,
      status TEXT,
      meta JSONB,
      created_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      price NUMERIC,
      versions JSONB,
      stock_qty INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      name TEXT,
      settings JSONB,
      created_at TIMESTAMP DEFAULT now()
    );
  `);

}
initDb().catch(e=>console.error("DB init error",e));

// Helpers
function requireAdminKey(req, res, next) {
  // Allow if ADMIN_API_KEY not configured (development convenience)
  if (!ADMIN_API_KEY) return next();
  const provided = req.headers['x-admin-key'] || req.query.admin_key;
  if (!provided || provided !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'admin key required' });
  }
  next();
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.status(401).json({ ok:false, error: 'auth required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch(e) {
    return res.status(401).json({ ok:false, error: 'invalid auth token' });
  }
}

// Public: read-only settings (exclude admin_password)
app.get('/settings', async (req, res) => {
  try {
    const r = await pool.query(`SELECT key, value FROM admin_settings WHERE key != 'admin_password'`);
    const out = {};
    r.rows.forEach(row=>{ out[row.key] = row.value; });
    res.json({ ok: true, settings: out });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server error' }); }
});

// Set settings (protected) - requires admin credentials (cookie) or admin key
app.post('/settings', async (req, res) => {
  try {
    // allow using admin key OR existing session cookie
    const provided = req.headers['x-admin-key'] || req.query.admin_key;
    let allowed = false;
    if (ADMIN_API_KEY && provided === ADMIN_API_KEY) allowed = true;
    else {
      const token = req.cookies && req.cookies.token;
      if (token) {
        try { jwt.verify(token, JWT_SECRET); allowed = true; } catch(e) {}
      }
    }
    if (!allowed) return res.status(401).json({ ok:false, error:'admin auth required' });
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ ok:false, error:'key required' });
    await pool.query(`INSERT INTO admin_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [key, String(value)]);
    res.json({ ok: true });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server error' }); }
});

// Admin password set/change endpoint
app.post('/admin/password', async (req, res) => {
  try {
    const { password, current_password } = req.body;
    if (!password || typeof password !== 'string' || password.length < 6) return res.status(400).json({ ok:false, error:'password min 6 chars' });
    // check if password exists
    const r = await pool.query(`SELECT value FROM admin_settings WHERE key=$1`, ['admin_password']);
    if (r.rowCount === 0) {
      // allow set if no password yet
      const hash = await bcrypt.hash(password, 10);
      await pool.query(`INSERT INTO admin_settings (key,value) VALUES ($1,$2)`, ['admin_password', hash]);
      return res.json({ ok:true, message:'password set' });
    } else {
      // require current_password OR admin key OR logged-in session
      let allowed = false;
      const provided = req.headers['x-admin-key'] || req.query.admin_key;
      if (ADMIN_API_KEY && provided === ADMIN_API_KEY) allowed = true;
      // check session cookie
      const token = req.cookies && req.cookies.token;
      if (token) {
        try { jwt.verify(token, JWT_SECRET); allowed = true; } catch(e) {}
      }
      if (!allowed) {
        // verify current_password
        if (!current_password) return res.status(401).json({ ok:false, error:'current_password required' });
        const hash = r.rows[0].value;
        const match = await bcrypt.compare(current_password, hash);
        if (!match) return res.status(401).json({ ok:false, error:'wrong current password' });
        allowed = true;
      }
      if (allowed) {
        const newHash = await bcrypt.hash(password, 10);
        await pool.query(`INSERT INTO admin_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, ['admin_password', newHash]);
        return res.json({ ok:true, message:'password updated' });
      }
    }
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server error' }); }
});

// Auth endpoints: login (creates cookie), logout, verify
app.post('/auth/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ ok:false, error:'password required' });
    const r = await pool.query(`SELECT value FROM admin_settings WHERE key=$1`, ['admin_password']);
    if (r.rowCount === 0) return res.status(400).json({ ok:false, error:'no password set' });
    const hash = r.rows[0].value;
    const ok = await bcrypt.compare(password, hash);
    if (!ok) return res.status(401).json({ ok:false, error:'wrong password' });
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '7d' });
    // set cookie (HttpOnly)
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server error' }); }
});

app.post('/auth/logout', (req,res)=>{
  res.clearCookie('token');
  res.json({ ok:true });
});

app.get('/auth/me', (req,res)=>{
  const token = req.cookies && req.cookies.token;
  if (!token) return res.json({ ok:false, loggedIn:false });
  try {
    jwt.verify(token, JWT_SECRET);
    return res.json({ ok:true, loggedIn:true });
  } catch(e) {
    return res.json({ ok:false, loggedIn:false });
  }
});

// Orders: public endpoint to create an order and record payment info
const { v4: uuidv4 } = require('uuid');



// Products endpoints
app.get('/products', async (req,res)=>{
  try {
    const r = await pool.query(`SELECT * FROM products WHERE is_active=TRUE ORDER BY name`);
    res.json({ ok:true, products: r.rows });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server error' }); }
});

app.get('/products/all', requireAuth, async (req,res)=>{
  try {
    const r = await pool.query(`SELECT * FROM products ORDER BY created_at DESC`);
    res.json({ ok:true, products: r.rows });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server error' }); }
});

app.post('/products', requireAuth, async (req,res)=>{
  try {
    const p = req.body;
    if (!p.id) p.id = (p.name || 'prod').toLowerCase().replace(/\s+/g,'-') + '-' + Math.floor(Math.random()*9000+1000);
    await pool.query(`INSERT INTO products (id,name,description,price,versions,stock_qty,is_active,image_url,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`, [p.id,p.name||'',p.description||'',p.price||0, p.versions||null, p.stock_qty||0, p.is_active!==false, p.image_url||null]);
    res.json({ ok:true, product_id: p.id });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server error' }); }
});

app.patch('/products/:id', requireAuth, async (req,res)=>{
  try {
    const id = req.params.id;
    const updates = req.body || {};
    // If stock_qty change, record inventory_event
    if (typeof updates.stock_qty !== 'undefined') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cur = await client.query('SELECT stock_qty FROM products WHERE id=$1 FOR UPDATE', [id]);
        if (cur.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ ok:false, error:'product not found' }); }
        const oldStock = Number(cur.rows[0].stock_qty || 0);
        const newStock = Number(updates.stock_qty);
        const diff = newStock - oldStock;
        await client.query('UPDATE products SET stock_qty=$1, updated_at=now() WHERE id=$2', [newStock, id]);
        await client.query('INSERT INTO inventory_events (product_id, change_qty, reason, meta) VALUES ($1,$2,$3,$4)', [id, diff, 'manual_adjust', updates.meta || null]);
        await client.query('COMMIT');
        return res.json({ ok:true });
      } catch(e){ try{ await client.query('ROLLBACK'); }catch(err){} console.error(e); return res.status(500).json({ ok:false, error:'server error' }); } finally { client.release(); }
    } else {
      // general update
      const allowed = ['name','description','price','versions','is_active','image_url'];
      const sets = [];
      const vals = [];
      let i=1;
      for (const k of allowed) {
        if (typeof updates[k] !== 'undefined') {
          sets.push(k + ' = $' + i);
          vals.push(updates[k]);
          i++;
        }
      }
      if (sets.length === 0) return res.json({ ok:true });
      vals.push(id);
      await pool.query(`UPDATE products SET ${sets.join(',')}, updated_at=now() WHERE id=$${i}`, vals);
      return res.json({ ok:true });
    }
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server error' }); }
});
app.post('/orders', async (req, res) => {
  const client = await pool.connect();
  try {
    const { cart, subtotal, payment_type, payment_ref, customer_name, currency } = req.body;
    const id = uuidv4();
    const status = payment_type === 'cash' ? 'paid' : 'pending';
    await client.query('BEGIN');
    // Validate and decrement stock with row-level locks
    for (const item of cart) {
      const prodId = item.product_id || item.product?.id || item.id;
      const qty = Number(item.qty || item.quantity || 0);
      if (!prodId) { await client.query('ROLLBACK'); return res.status(400).json({ ok:false, error:'invalid cart item' }); }
      const p = await client.query('SELECT stock_qty FROM products WHERE id=$1 FOR UPDATE', [prodId]);
      if (p.rowCount === 0) { await client.query('ROLLBACK'); return res.status(400).json({ ok:false, error:`Product not found: ${prodId}` }); }
      const stock = Number(p.rows[0].stock_qty || 0);
      if (stock < qty) { await client.query('ROLLBACK'); return res.status(400).json({ ok:false, error:`Not enough stock for ${prodId}` }); }
      const newStock = stock - qty;
      await client.query('UPDATE products SET stock_qty=$1, updated_at=now() WHERE id=$2', [newStock, prodId]);
      await client.query('INSERT INTO inventory_events (product_id, change_qty, reason, meta) VALUES ($1,$2,$3,$4)', [prodId, -qty, 'sale', { order_id: id, item }]);
      await client.query('INSERT INTO order_items (order_id, product_id, version_key, flavor_key, qty, unit_price, meta) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, prodId, item.version_key || item.version || null, item.flavor_key || (item.version && item.version.flavor && item.version.flavor.key) || null, qty, item.unit_price || (item.version && item.version.price) || 0, item]);
    }
    // insert order record
    await client.query('INSERT INTO orders (id, payload, payment_type, payment_ref, status, customer_name, created_at) VALUES ($1,$2,$3,$4,$5,$6,now())', [id, { cart, subtotal, currency: currency || 'USD' }, payment_type, payment_ref || null, status, customer_name || null]);
    // payment record
    await client.query('INSERT INTO payments (method, amount, currency, reference, status, meta) VALUES ($1,$2,$3,$4,$5,$6)', [payment_type, subtotal, currency || 'USD', payment_ref || null, status, { order_id: id }]);
    await client.query('COMMIT');
    // Prepare payment URL if needed (keep existing logic)
    const r = await pool.query(`SELECT key, value FROM admin_settings WHERE key IN ('cash_app_handle','venmo_handle')`);
    const handles = {};
    r.rows.forEach(row=>handles[row.key]=row.value);
    let payment_url = null;
    if (payment_type === 'cashapp' && handles.cash_app_handle) {
      const tag = handles.cash_app_handle.replace(/^\$?/,'');
      payment_url = `https://cash.app/$${encodeURIComponent(tag)}?amount=${encodeURIComponent(String(subtotal||0))}`;
    } else if (payment_type === 'venmo' && handles.venmo_handle) {
      const tag = handles.venmo_handle.replace(/^@?/,''); 
      payment_url = `https://venmo.com/${encodeURIComponent(tag)}?txn=pay&amount=${encodeURIComponent(String(subtotal||0))}`;
    }
    res.json({ ok:true, order_id: id, payment_url });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch(err) {}
    console.error('Order error', e);
    res.status(500).json({ ok:false, error:'server error' });
  } finally {
    client.release();
  }
});


// Admin: list orders (protected)
app.get('/orders', requireAuth, async (req,res)=>{
  try {
    const r = await pool.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 500`);
    res.json({ ok:true, orders: r.rows });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server error' }); }
});

// Payments listing (protected)
app.get('/payments', requireAuth, async (req,res)=>{
  try {
    const r = await pool.query(`SELECT * FROM payments ORDER BY created_at DESC LIMIT 500`);
    res.json({ ok:true, payments: r.rows });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server error' }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, ()=> console.log('API listening on', PORT));
