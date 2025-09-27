
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/snaks' });
(async()=>{
  try{
    const seed = JSON.parse(fs.readFileSync('../seed_products.json','utf8'));
    for(const p of seed){
      await pool.query('INSERT INTO products(id,name,price,stock_qty,is_active,metadata) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, price=EXCLUDED.price, stock_qty=EXCLUDED.stock_qty, is_active=EXCLUDED.is_active, metadata=EXCLUDED.metadata', [p.id,p.name,p.price,p.stock_qty,p.is_active,p]);
    }
    console.log('Seeded products');
    process.exit(0);
  }catch(e){ console.error(e); process.exit(1) }
})();
