const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/snaks',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const sql = fs.readFileSync('migrations/create_tables.sql', 'utf8');

(async () => {
  try {
    // split on semicolons, filter out empty statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (let stmt of statements) {
      await pool.query(stmt);
    }

    console.log('✅ Migrations applied');
    process.exit(0);
  } catch (e) {
    console.error('❌ Migration error:', e);
    process.exit(1);
  }
})();
