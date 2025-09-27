const { Pool } = require('pg');
const products = require('../seed_products.json');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/snaks',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

(async () => {
  try {
    for (let p of products) {
      await pool.query(
        `INSERT INTO products (id, name, price, stock_qty, is_active) 
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (id) DO UPDATE 
         SET name = EXCLUDED.name,
             price = EXCLUDED.price,
             stock_qty = EXCLUDED.stock_qty,
             is_active = EXCLUDED.is_active`,
        [
          p.id || crypto.randomUUID(), // ensure id since products.id is PK
          p.name,
          p.price,
          p.stock ?? 0
        ]
      );
    }
    console.log('✅ Seed data inserted');
    process.exit(0);
  } catch (e) {
    console.error('❌ Error inserting seed data:', e);
    process.exit(1);
  }
})();
