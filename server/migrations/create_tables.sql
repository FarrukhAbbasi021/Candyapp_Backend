
CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  name TEXT DEFAULT 'Snakz Plug',
  settings JSONB DEFAULT '{}' ,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(10,2) DEFAULT 0,
  stock_qty INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  name TEXT DEFAULT 'Snakz Plug',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(10,2) DEFAULT 0,
  stock INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer JSONB,
  status TEXT DEFAULT 'created',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id),
  qty INTEGER,
  price NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS inventory_events (
  id SERIAL PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  change INTEGER,
  reason TEXT,
  order_id INTEGER,
  created_at TIMESTAMP DEFAULT now()
);

-- ensure there's a default store row
INSERT INTO stores (id, name)
SELECT 1, 'Snakz Plug'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE id=1);

  metadata JSONB DEFAULT '{}' ,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer JSONB,
  status TEXT DEFAULT 'created',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id),
  qty INTEGER,
  price NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS inventory_events (
  id SERIAL PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  change INTEGER,
  reason TEXT,
  order_id INTEGER,
  created_at TIMESTAMP DEFAULT now()
);

-- ensure there's a default store row
INSERT INTO stores (id, name) SELECT 1, 'Snakz Plug' WHERE NOT EXISTS (SELECT 1 FROM stores WHERE id=1);
