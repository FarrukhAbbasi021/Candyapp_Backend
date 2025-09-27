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
        `INSERT INTO products (name, price, stock, active) 
         VALUES ($1, $2, $3, true)`,
        [p.name, p.price, p.stock ?? 0]
      );
    }
    console.log('✅ Seed data inserted');
    process.exit(0);
  } catch (e) {
    console.error('❌ Error inserting seed data:', e);
    process.exit(1);
  }
})();
