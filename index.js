
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/snaks' });

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Simple admin auth via single password env var
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'adminpw';

// Store info endpoints
app.get('/api/store', async (req,res)=>{
  // return simple store settings from table 'stores' (assume single store id=1)
  try{
    const r = await pool.query('SELECT * FROM stores LIMIT 1');
    res.json(r.rows[0] || {});
  }catch(e){ res.status(500).send(e.message) }
});

app.patch('/api/store', async (req,res)=>{
  const {password} = req.headers;
  if(password !== ADMIN_PASSWORD) return res.status(401).send('unauthorized');
  const {name,theme} = req.body;
  try{
    const r = await pool.query('UPDATE stores SET name=$1, theme=$2 WHERE id=1 RETURNING *', [name||null, theme||null]);
    res.json(r.rows[0]);
  }catch(e){ res.status(500).send(e.message) }
});

// Products
app.get('/api/products', async (req,res)=>{
  try{
    const r = await pool.query('SELECT id,name,price,stock_qty,is_active,metadata FROM products WHERE is_active=true ORDER BY name');
    res.json(r.rows.map(row=>({...row, metadata: row.metadata})));
  }catch(e){ res.status(500).send(e.message) }
});

app.get('/api/products/all', async (req,res)=>{
  const {password} = req.headers;
  if(password !== ADMIN_PASSWORD) return res.status(401).send('unauthorized');
  try{
    const r = await pool.query('SELECT * FROM products ORDER BY name');
    res.json(r.rows);
  }catch(e){ res.status(500).send(e.message) }
});

app.post('/api/products', async (req,res)=>{
  const {password} = req.headers;
  if(password !== ADMIN_PASSWORD) return res.status(401).send('unauthorized');
  const {id,name,price,stock_qty,is_active,metadata} = req.body;
  try{
    const r = await pool.query('INSERT INTO products(id,name,price,stock_qty,is_active,metadata) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [id,name,price||0,stock_qty||0,!!is_active, metadata||{}]);
    res.json(r.rows[0]);
  }catch(e){ res.status(500).send(e.message) }
});

app.patch('/api/products/:id', async (req,res)=>{
  const {password} = req.headers;
  if(password !== ADMIN_PASSWORD) return res.status(401).send('unauthorized');
  const id = req.params.id;
  const {name,price,stock_qty,is_active,metadata} = req.body;
  try{
    const r = await pool.query('UPDATE products SET name=COALESCE($1,name), price=COALESCE($2,price), stock_qty=COALESCE($3,stock_qty), is_active=COALESCE($4,is_active), metadata=COALESCE($5,metadata) WHERE id=$6 RETURNING *',
      [name,price,stock_qty,is_active,metadata,id]);
    res.json(r.rows[0]);
  }catch(e){ res.status(500).send(e.message) }
});

// Orders - create order in transaction with SELECT FOR UPDATE
app.post('/api/orders', async (req,res)=>{
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const {customer, items} = req.body;
    // create order
    const ord = await client.query('INSERT INTO orders(customer, status) VALUES($1,$2) RETURNING *', [JSON.stringify(customer||{}), 'created']);
    const order = ord.rows[0];
    // for each item: lock product row, check stock, decrement, insert order_items and inventory_events
    for(const it of items){
      const pid = it.productId || it.id;
      const qty = Number(it.qty || it.quantity || 1);
      const p = await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [pid]);
      if(p.rows.length===0) throw new Error('product not found: ' + pid);
      const prod = p.rows[0];
      if(prod.stock_qty < qty) throw new Error('out of stock: ' + pid);
      await client.query('UPDATE products SET stock_qty = stock_qty - $1 WHERE id=$2', [qty, pid]);
      await client.query('INSERT INTO order_items(order_id, product_id, qty, price) VALUES($1,$2,$3,$4)', [order.id, pid, qty, prod.price]);
      await client.query('INSERT INTO inventory_events(product_id, change, reason, order_id) VALUES($1,$2,$3,$4)', [pid, -qty, 'sale', order.id]);
    }
    await client.query('COMMIT');
    res.json({ok:true, order});
  }catch(e){
    await client.query('ROLLBACK');
    res.status(400).send(e.message);
  }finally{ client.release() }
});

app.get('/api/orders', async (req,res)=>{
  const {password} = req.headers;
  if(password !== ADMIN_PASSWORD) return res.status(401).send('unauthorized');
  try{
    const r = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(r.rows);
  }catch(e){ res.status(500).send(e.message) }
});

app.patch('/api/orders/:id', async (req,res)=>{
  const {password} = req.headers;
  if(password !== ADMIN_PASSWORD) return res.status(401).send('unauthorized');
  const id = req.params.id;
  const {status} = req.body;
  try{
    const r = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [status, id]);
    res.json(r.rows[0]);
  }catch(e){ res.status(500).send(e.message) }
});

// Serve frontend static files if built
const front = path.join(__dirname, '..', 'dist');
if (fs.existsSync(front)) {
  app.use(express.static(front));
  app.get('*', (req,res)=>{ res.sendFile(path.join(front,'index.html')) });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Listening on', PORT));
