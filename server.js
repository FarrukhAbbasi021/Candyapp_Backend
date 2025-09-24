
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

app.post('/orders', async (req, res) => {
  try {
    const { cart, subtotal, payment_type, payment_ref, customer_name, currency } = req.body;
    const id = uuidv4();
    const status = payment_type === 'cash' ? 'paid' : 'pending';
    const payload = { cart, subtotal, currency: currency || 'USD' };
    await pool.query(`INSERT INTO orders (id, payload, payment_type, payment_ref, status, customer_name) VALUES ($1,$2,$3,$4,$5,$6)`, [id, payload, payment_type, payment_ref || null, status, customer_name || null]);
    // Also add a payment record
    await pool.query(`INSERT INTO payments (method, amount, currency, reference, status, meta) VALUES ($1,$2,$3,$4,$5,$6)`, [payment_type, subtotal || 0, currency || 'USD', payment_ref || null, status, JSON.stringify({ order_id: id })]);
    // If Venmo/CashApp, also return a deep-link url to open app/web
    // Read handles from settings
    const r = await pool.query(`SELECT key, value FROM admin_settings WHERE key IN ('cash_app_handle','venmo_handle')`);
    const handles = {};
    r.rows.forEach(row=>handles[row.key]=row.value);
    let payment_url = null;
    if (payment_type === 'cashapp' && handles.cash_app_handle) {
      // Cash App web link format: https://cash.app/$Cashtag (amount query may or may not work universally)
      const tag = handles.cash_app_handle.replace(/^\$?/,'');
      payment_url = `https://cash.app/$${encodeURIComponent(tag)}?amount=${encodeURIComponent(String(subtotal||0))}`;
    } else if (payment_type === 'venmo' && handles.venmo_handle) {
      // Venmo web payment link: https://venmo.com/{handle}?txn=pay&amount={amount}
      const handle = handles.venmo_handle.replace(/^@/,'').replace(/^\//,'');
      payment_url = `https://venmo.com/${encodeURIComponent(handle)}?txn=pay&amount=${encodeURIComponent(String(subtotal||0))}`;
    }
    res.json({ ok:true, order_id: id, payment_url });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server error' }); }
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
