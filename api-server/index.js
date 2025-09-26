/**
 * Simple Express API server for Snakz Plug / Candyapp
 * - Use environment variable DATABASE_URL for Postgres (e.g. provided Render URL)
 * - Use ADMIN_PASSWORD for single-password admin login
 */

const express = require('express');
const bodyParser = require('body-parser');
const pg = require('pg');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://snakzplug_db_user:password@localhost/snakzplug_db';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const PORT = process.env.PORT || 4000;

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

// Helper: run a transaction callback
async function withTx(client, cb) {
  try {
    await client.query('BEGIN');
    const res = await cb();
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// Health
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Store endpoints
 */
app.get('/api/store', async (req, res) => {
  const { rows } = await pool.query('SELECT key, value FROM store_settings');
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({ settings });
});

app.patch('/api/store', async (req, res) => {
  const adminPass = req.headers['x-admin-password'] || '';
  if (adminPass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });

  const updates = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const k of Object.keys(updates)) {
      const v = updates[k];
      await client.query(
        `INSERT INTO store_settings(key, value) VALUES($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [k, String(v)]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/**
 * Products endpoints
 */
app.get('/api/products', async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, price_cents, stock, active, metadata FROM products WHERE active = true ORDER BY id');
  res.json({ products: rows });
});

app.get('/api/products/all', async (req, res) => {
  const adminPass = req.headers['x-admin-password'] || '';
  if (adminPass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  const { rows } = await pool.query('SELECT id, name, price_cents, stock, active, metadata FROM products ORDER BY id');
  res.json({ products: rows });
});

app.post('/api/products', async (req, res) => {
  const adminPass = req.headers['x-admin-password'] || '';
  if (adminPass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  const { name, price_cents, stock, active, metadata } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO products (name, price_cents, stock, active, metadata) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, price_cents||0, stock||0, active===true, metadata||{}]
  );
  // record inventory event for initial stock
  await pool.query(`INSERT INTO inventory_events(product_id, delta, reason) VALUES ($1,$2,$3)`, [rows[0].id, stock||0, 'initial']);
  res.json({ product: rows[0] });
});

app.patch('/api/products/:id', async (req, res) => {
  const adminPass = req.headers['x-admin-password'] || '';
  if (adminPass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  const id = Number(req.params.id);
  const { name, price_cents, stock_delta, stock, active, metadata } = req.body;
  const client = await pool.connect();
  try {
    await withTx(client, async () => {
      // If stock_delta present, do SELECT FOR UPDATE and update with inventory_events
      if (typeof stock_delta === 'number') {
        const prod = await client.query('SELECT stock FROM products WHERE id = $1 FOR UPDATE', [id]);
        if (prod.rows.length === 0) throw new Error('product not found');
        const curr = prod.rows[0].stock;
        const newStock = curr + stock_delta;
        if (newStock < 0) throw new Error('insufficient stock');
        await client.query('UPDATE products SET stock = $1 WHERE id = $2', [newStock, id]);
        await client.query('INSERT INTO inventory_events(product_id, delta, reason) VALUES ($1,$2,$3)', [id, stock_delta, 'manual']);
      }
      // If absolute stock provided
      if (typeof stock === 'number') {
        await client.query('UPDATE products SET stock = $1 WHERE id = $2', [stock, id]);
        await client.query('INSERT INTO inventory_events(product_id, delta, reason) VALUES ($1,$2,$3)', [id, stock, 'set']);
      }
      // other fields
      const updates = [];
      const params = [];
      let idx = 1;
      if (typeof name !== 'undefined') { updates.push(`name = $${idx++}`); params.push(name); }
      if (typeof price_cents !== 'undefined') { updates.push(`price_cents = $${idx++}`); params.push(price_cents); }
      if (typeof active !== 'undefined') { updates.push(`active = $${idx++}`); params.push(active); }
      if (typeof metadata !== 'undefined') { updates.push(`metadata = $${idx++}`); params.push(metadata); }
      if (updates.length > 0) {
        params.push(id);
        await client.query(`UPDATE products SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
      }
    });
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    res.json({ product: rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

/**
 * Orders endpoints
 * POST /api/orders -> create order and decrement stock within transaction
 */
app.post('/api/orders', async (req, res) => {
  const { items, customer } = req.body; // items: [{product_id, qty, price_cents}]
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'no items' });

  const client = await pool.connect();
  try {
    await withTx(client, async () => {
      const orderRes = await client.query(
        `INSERT INTO orders(customer_info, status) VALUES ($1,$2) RETURNING id, created_at`,
        [customer||{}, 'New']
      );
      const orderId = orderRes.rows[0].id;
      for (const it of items) {
        const pid = Number(it.product_id);
        const qty = Number(it.qty);
        if (qty <= 0) throw new Error('invalid qty');
        // lock product
        const prod = await client.query('SELECT stock, price_cents FROM products WHERE id = $1 FOR UPDATE', [pid]);
        if (prod.rows.length === 0) throw new Error('product not found: '+pid);
        const stock = prod.rows[0].stock;
        if (stock < qty) throw new Error(`insufficient stock for product ${pid}`);
        // decrement
        const newStock = stock - qty;
        await client.query('UPDATE products SET stock = $1 WHERE id = $2', [newStock, pid]);
        await client.query('INSERT INTO inventory_events(product_id, delta, reason, order_id) VALUES ($1,$2,$3,$4)', [pid, -qty, 'sale', orderId]);
        await client.query('INSERT INTO order_items(order_id, product_id, qty, price_cents) VALUES ($1,$2,$3,$4)', [orderId, pid, qty, it.price_cents || prod.rows[0].price_cents]);
      }
      res.json({ ok: true, order_id: orderId });
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/orders', async (req, res) => {
  const adminPass = req.headers['x-admin-password'] || '';
  if (adminPass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
  res.json({ orders: rows });
});

app.patch('/api/orders/:id', async (req, res) => {
  const adminPass = req.headers['x-admin-password'] || '';
  if (adminPass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  const id = Number(req.params.id);
  const { status } = req.body;
  await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
  res.json({ ok: true });
});

// Admin login check (doesn't return password)
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    // generate a short-lived token (in-memory stateless simple)
    const token = crypto.randomBytes(18).toString('hex');
    // Note: for production, use proper sessions or JWTs
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ ok: false });
  }
});

app.listen(PORT, () => {
  console.log('API server listening on', PORT);
});