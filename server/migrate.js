const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/snaks',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const sql = fs.readFileSync('migrations/create_tables.sql', 'utf8');

(async () => {
  try {
    await pool.query(sql);
    console.log('Migrations applied');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
