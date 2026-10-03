import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { adminApiKey, createBook, sessionCookie, startApp, withSession } from "./helpers.js";

let app: FastifyInstance;
let pool: Pool;

beforeAll(async () => {
  ({ app, pool } = await startApp());
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

test("a buyer builds a session cart without reserving stock", async () => {
  const book = await createBook(app, {
    isbn: "9780000000020",
    title: "Captains of the Sands",
    priceCents: 3000,
    stock: 2,
  });

  const added = await app.inject({
    method: "POST",
    url: "/cart/items",
    payload: { bookId: book.id, quantity: 4 },
  });
  expect(added.statusCode).toBe(201);
  const cookie = sessionCookie(added);
  expect(added.json().items).toEqual([
    {
      bookId: book.id,
      title: "Captains of the Sands",
      quantity: 4,
      currentPriceCents: 3000,
    },
  ]);

  const changed = await app.inject(
    withSession(cookie, {
      method: "PATCH",
      url: `/cart/items/${book.id}`,
      payload: { quantity: 1 },
    }),
  );
  expect(changed.statusCode).toBe(200);
  expect(changed.json().items[0].quantity).toBe(1);

  const viewed = await app.inject(withSession(cookie, { method: "GET", url: "/cart" }));
  expect(viewed.json().items).toHaveLength(1);

  const removed = await app.inject(
    withSession(cookie, { method: "DELETE", url: `/cart/items/${book.id}` }),
  );
  expect(removed.json().items).toEqual([]);

  const detail = await app.inject({ method: "GET", url: `/books/${book.id}` });
  expect(detail.json().book.stock).toBe(2);
});

test("the cart shows the current catalog price and does not reserve stock", async () => {
  const book = await createBook(app, {
    isbn: "9780000000021",
    title: "Live price",
    priceCents: 1000,
    stock: 6,
  });
  const added = await app.inject({
    method: "POST",
    url: "/cart/items",
    payload: { bookId: book.id, quantity: 2 },
  });
  const cookie = sessionCookie(added);

  const repriced = await app.inject({
    method: "PATCH",
    url: `/admin/books/${book.id}`,
    headers: { "x-api-key": adminApiKey },
    payload: { priceCents: 1800 },
  });
  expect(repriced.statusCode).toBe(200);

  const viewed = await app.inject(withSession(cookie, { method: "GET", url: "/cart" }));
  expect(viewed.json().items[0].currentPriceCents).toBe(1800);

  const detail = await app.inject({ method: "GET", url: `/books/${book.id}` });
  expect(detail.json().book.stock).toBe(6);
});
