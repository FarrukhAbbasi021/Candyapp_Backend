
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());

const connectionString = process.env.DATABASE_URL || process.env.PG_URI || 'postgresql://postgres:postgres@localhost:5432/candydb';
const pool = new Pool({ connectionString, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

// create tables
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      method TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      currency TEXT DEFAULT 'USD',
      reference TEXT,
      status TEXT DEFAULT 'pending',
      meta JSONB,
      created_at TIMESTAMP DEFAULT now()
    );
  `);
  console.log('DB initialized');
}
init().catch(e=>console.error('init error', e));

// helper: require admin key for sensitive operations
function requireAdminKey(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY || '';
  const provided = req.headers['x-admin-key'] || req.query.admin_key;
  if (!adminKey) {
    // allow if no ADMIN_API_KEY configured (development)
    return next();
  }
  if (!provided || provided !== adminKey) {
    return res.status(401).json({ error: 'admin key required' });
  }
  next();
}

// SETTINGS routes - align with frontend snippet (/settings)
// POST /settings - set password or other settings, requires admin key
app.post('/settings', requireAdminKey, async (req, res) => {
  try {
    const { password, key, value } = req.body;
    if (password) {
      if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'password min 6 chars' });
      const hash = await bcrypt.hash(password, 10);
      await pool.query(`INSERT INTO admin_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, ['admin_password', hash]);
      return res.json({ ok: true });
    }
    if (key && value !== undefined) {
      await pool.query(`INSERT INTO admin_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [key, String(value)]);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'password or key/value required' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

// GET /settings - public settings (safe to expose). exclude admin_password
app.get('/settings', async (req, res) => {
  try {
    const r = await pool.query(`SELECT key, updated_at FROM admin_settings WHERE key != 'admin_password'`);
    res.json({ ok: true, settings: r.rows });
  } catch(e) { console.error(e); res.status(500).json({ error: 'server error' }); }
});

// auth verify (align with snippet /auth/verify)
app.post('/auth/verify', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ ok: false, error: 'password required' });
    const r = await pool.query(`SELECT value FROM admin_settings WHERE key=$1`, ['admin_password']);
    if (r.rowCount === 0) return res.json({ ok: false, error: 'no password set' });
    const hash = r.rows[0].value;
    const match = await bcrypt.compare(password, hash);
    res.json({ ok: match });
  } catch(e) { console.error(e); res.status(500).json({ ok: false, error: 'server error' }); }
});

// Backwards-compatible endpoints
app.post('/admin/password', requireAdminKey, async (req,res)=> {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'password min 6 chars' });
    const hash = await bcrypt.hash(password,10);
    await pool.query(`INSERT INTO admin_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, ['admin_password', hash]);
    res.json({ ok: true });
  } catch(e){ console.error(e); res.status(500).json({ error:'server error' }); }
});

app.get('/admin/password', async (req,res)=> {
  try {
    const r = await pool.query(`SELECT key, updated_at FROM admin_settings WHERE key=$1`, ['admin_password']);
    if (r.rowCount===0) return res.json({ exists: false });
    res.json({ exists: true, updated_at: r.rows[0].updated_at });
  } catch(e){ console.error(e); res.status(500).json({ error:'server error' }); }
});

app.post('/auth/check', async (req,res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ ok: false, error: 'password required' });
    const r = await pool.query(`SELECT value FROM admin_settings WHERE key=$1`, ['admin_password']);
    if (r.rowCount===0) return res.json({ ok: false, error: 'no password set' });
    const hash = r.rows[0].value;
    const match = await bcrypt.compare(password, hash);
    res.json({ ok: match });
  } catch(e){ console.error(e); res.status(500).json({ ok:false, error:'server error' }); }
});

// Payments
app.post('/payments', async (req, res) => {
  try {
    const { method, amount, currency='USD', reference, meta } = req.body;
    if (!method || amount === undefined) return res.status(400).json({ error: 'method and amount required' });
    const allowed = ['cash','cashapp','venmo'];
    if (!allowed.includes(method.toLowerCase())) return res.status(400).json({ error: 'unsupported method' });
    let status = 'pending';
    if (method.toLowerCase()==='cash' && reference==='in_person') status='received';
    if ((method.toLowerCase()==='cashapp' || method.toLowerCase()==='venmo') && reference && reference.startsWith('tx:')) status='verified';
    const r = await pool.query(
      `INSERT INTO payments (method, amount, currency, reference, status, meta) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [method.toLowerCase(), amount, currency, reference || null, status, meta ? meta : null]
    );
    res.json({ ok: true, payment: r.rows[0] });
  } catch(e){ console.error(e); res.status(500).json({ error:'server error' }); }
});

app.get('/payments', async (req,res) => {
  try {
    const r = await pool.query(`SELECT * FROM payments ORDER BY created_at DESC LIMIT 200`);
    res.json({ ok: true, payments: r.rows });
  } catch(e){ console.error(e); res.status(500).json({ error:'server error' }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, ()=> console.log('API listening on', PORT));
