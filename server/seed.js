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
        'INSERT INTO products(name, price, stock) VALUES ($1,$2,$3)',
        [p.name, p.price, p.stock]
      );
    }
    console.log('Seed data inserted');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
