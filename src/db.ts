import pg from "pg";

const { Pool } = pg;

export type Pool = pg.Pool;
export type Db = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  id UUID PRIMARY KEY,
  isbn TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock INTEGER NOT NULL CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS carts (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE REFERENCES sessions (id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id UUID NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (cart_id, book_id)
);

CREATE TABLE IF NOT EXISTS shipping_rates (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  postal_code_start INTEGER NOT NULL,
  postal_code_end INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0)
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions (id),
  status TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  address TEXT NOT NULL,
  email TEXT NOT NULL,
  shipping_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders (id),
  book_id UUID NOT NULL,
  isbn TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL UNIQUE REFERENCES orders (id),
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
);
`;

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
  await pool.query(`
    INSERT INTO shipping_rates (postal_code_start, postal_code_end, amount_cents)
    SELECT * FROM (VALUES
      (1000000, 5999999, 1500),
      (20000000, 23799999, 2500)
    ) AS seed (postal_code_start, postal_code_end, amount_cents)
    WHERE NOT EXISTS (SELECT 1 FROM shipping_rates)
  `);
}

export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      payments,
      order_items,
      orders,
      cart_items,
      carts,
      sessions,
      books
    RESTART IDENTITY CASCADE
  `);
}
