import pg from "pg";

const { Pool } = pg;

export type Pool = pg.Pool;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS cart;
CREATE SCHEMA IF NOT EXISTS checkout;
CREATE SCHEMA IF NOT EXISTS payment;

CREATE TABLE IF NOT EXISTS catalog.books (
  id UUID PRIMARY KEY,
  isbn TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock INTEGER NOT NULL CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS cart.sessions (
  id UUID PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS cart.carts (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE REFERENCES cart.sessions (id)
);

CREATE TABLE IF NOT EXISTS cart.cart_items (
  cart_id UUID NOT NULL REFERENCES cart.carts (id) ON DELETE CASCADE,
  book_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (cart_id, book_id)
);

CREATE TABLE IF NOT EXISTS checkout.shipping_rates (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  postal_code_start INTEGER NOT NULL,
  postal_code_end INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0)
);

CREATE TABLE IF NOT EXISTS checkout.orders (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL,
  status TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  address TEXT NOT NULL,
  email TEXT NOT NULL,
  shipping_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  payment_id UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS checkout.order_items (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES checkout.orders (id),
  book_id UUID NOT NULL,
  isbn TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payment.payments (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
);
`;

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
  await pool.query(`
    INSERT INTO checkout.shipping_rates (postal_code_start, postal_code_end, amount_cents)
    SELECT * FROM (VALUES
      (1000000, 5999999, 1500),
      (20000000, 23799999, 2500)
    ) AS seed (postal_code_start, postal_code_end, amount_cents)
    WHERE NOT EXISTS (SELECT 1 FROM checkout.shipping_rates)
  `);
}

export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      payment.payments,
      checkout.order_items,
      checkout.orders,
      cart.cart_items,
      cart.carts,
      cart.sessions,
      catalog.books
    RESTART IDENTITY CASCADE
  `);
}
