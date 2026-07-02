-- TAREA16: tabla de orders para la skill de escritura create_order.
-- Nueva migracion (NO modifica schema.sql del seed original).
-- Aplicar con:
--   npx wrangler d1 execute bookstore-db --remote \
--     -c bookstore/wrangler.toml --file bookstore/migration-orders.sql
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  created_at TEXT NOT NULL
);