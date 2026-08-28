CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  stock INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  order_id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL,
  qty INTEGER NOT NULL,
  email TEXT NOT NULL,
  total REAL NOT NULL,
  client_order_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'confirmed',
  payment_token TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_order_id ON orders(client_order_id) WHERE client_order_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS licenses (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'creator',
  price REAL NOT NULL,
  uses_total INTEGER NOT NULL,
  uses_left INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);