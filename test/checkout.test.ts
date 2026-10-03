import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { adminApiKey, createBook, sessionCookie, startApp, withSession } from "./helpers.js";

let app: FastifyInstance;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ app, close } = await startApp());
});

afterAll(async () => {
  await close();
});

const delivery = {
  postalCode: "01310-100",
  address: "Rua Augusta, 100",
  email: "buyer@example.com",
};

async function cartWith(bookId: string, quantity: number): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/cart/items",
    payload: { bookId, quantity },
  });
  expect(response.statusCode).toBe(201);
  return sessionCookie(response);
}

test("an accepted payment creates an order, debits stock, clears the cart, and confirms by email", async () => {
  const book = await createBook(app, {
    isbn: "9780000000030",
    title: "Barren Lives",
    author: "Graciliano Ramos",
    priceCents: 2000,
    stock: 4,
  });
  const cookie = await cartWith(book.id, 2);

  const response = await app.inject(
    withSession(cookie, { method: "POST", url: "/checkout", payload: delivery }),
  );

  expect(response.statusCode).toBe(201);
  const body = response.json();
  expect(body.emailConfirmation).toBe("sent");
  expect(body.payment).toEqual({ status: "accepted", amountCents: 4000 + 1500 });
  expect(body.order.status).toBe("created");
  expect(body.order.shippingCents).toBe(1500);
  expect(body.order.totalCents).toBe(body.payment.amountCents);
  expect(body.order.items).toEqual([
    {
      bookId: book.id,
      isbn: "9780000000030",
      title: "Barren Lives",
      author: "Graciliano Ramos",
      quantity: 2,
      unitPriceCents: 2000,
    },
  ]);

  const cart = await app.inject(withSession(cookie, { method: "GET", url: "/cart" }));
  expect(cart.json().items).toEqual([]);

  const detail = await app.inject({ method: "GET", url: `/books/${book.id}` });
  expect(detail.json().book.stock).toBe(2);
});

test("a declined payment leaves stock and the cart unchanged", async () => {
  const book = await createBook(app, { isbn: "9780000000031", title: "Declined", stock: 3, priceCents: 1000 });
  const cookie = await cartWith(book.id, 1);

  const response = await app.inject(
    withSession(cookie, {
      method: "POST",
      url: "/checkout",
      headers: { "x-payment-simulation": "declined" },
      payload: delivery,
    }),
  );

  expect(response.statusCode).toBe(402);
  expect(response.json()).toEqual({ error: "payment_declined" });

  const cart = await app.inject(withSession(cookie, { method: "GET", url: "/cart" }));
  expect(cart.json().items).toHaveLength(1);
  const detail = await app.inject({ method: "GET", url: `/books/${book.id}` });
  expect(detail.json().book.stock).toBe(3);
});

test("a postal code outside shipping ranges is rejected and the cart stays", async () => {
  const book = await createBook(app, { isbn: "9780000000032", title: "Shipping", stock: 2 });
  const cookie = await cartWith(book.id, 1);

  const response = await app.inject(
    withSession(cookie, {
      method: "POST",
      url: "/checkout",
      payload: { ...delivery, postalCode: "99999-999" },
    }),
  );

  expect(response.statusCode).toBe(422);
  expect(response.json()).toEqual({ error: "shipping_unavailable" });
  const detail = await app.inject({ method: "GET", url: `/books/${book.id}` });
  expect(detail.json().book.stock).toBe(2);
  const cart = await app.inject(withSession(cookie, { method: "GET", url: "/cart" }));
  expect(cart.json().items).toHaveLength(1);
});

test("checkout fails when stock is insufficient", async () => {
  const book = await createBook(app, { isbn: "9780000000033", title: "Sold out", stock: 1 });
  const cookie = await cartWith(book.id, 2);

  const response = await app.inject(
    withSession(cookie, { method: "POST", url: "/checkout", payload: delivery }),
  );

  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ error: "insufficient_stock" });
  const detail = await app.inject({ method: "GET", url: `/books/${book.id}` });
  expect(detail.json().book.stock).toBe(1);
});

test("an order line keeps its price after the catalog price changes", async () => {
  const book = await createBook(app, { isbn: "9780000000034", title: "Snapshot", priceCents: 1000, stock: 2 });
  const cookie = await cartWith(book.id, 1);

  const response = await app.inject(
    withSession(cookie, { method: "POST", url: "/checkout", payload: delivery }),
  );
  expect(response.statusCode).toBe(201);
  expect(response.json().order.items[0].unitPriceCents).toBe(1000);
  expect(response.json().order.totalCents).toBe(1000 + 1500);

  const repriced = await app.inject({
    method: "PATCH",
    url: `/admin/books/${book.id}`,
    headers: { "x-api-key": adminApiKey },
    payload: { priceCents: 9000 },
  });
  expect(repriced.statusCode).toBe(200);

  const order = await app.inject(
    withSession(cookie, { method: "GET", url: `/orders/${response.json().order.id}` }),
  );
  expect(order.json().order.items[0].unitPriceCents).toBe(1000);

  const detail = await app.inject({ method: "GET", url: `/books/${book.id}` });
  expect(detail.json().book.priceCents).toBe(9000);
});

test("concurrent checkouts cannot sell the last copy twice", async () => {
  const book = await createBook(app, { isbn: "9780000000035", title: "Last copy", stock: 1, priceCents: 500 });
  const cookieA = await cartWith(book.id, 1);
  const cookieB = await cartWith(book.id, 1);

  const [a, b] = await Promise.all([
    app.inject(withSession(cookieA, { method: "POST", url: "/checkout", payload: { ...delivery, email: "a@example.com" } })),
    app.inject(withSession(cookieB, { method: "POST", url: "/checkout", payload: { ...delivery, email: "b@example.com" } })),
  ]);

  const statuses = [a.statusCode, b.statusCode].sort();
  expect(statuses).toEqual([201, 409]);

  const detail = await app.inject({ method: "GET", url: `/books/${book.id}` });
  expect(detail.json().book.stock).toBe(0);
});

test("the public host does not expose stock debit", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/internal/stock/debit",
    headers: { "x-internal-key": "test-internal-key" },
    payload: { lines: [] },
  });
  expect(response.statusCode).toBe(404);
});

test("two overlapping checkouts for one session charge only once", async () => {
  const book = await createBook(app, { isbn: "9780000000036", title: "One charge", stock: 5, priceCents: 500 });
  const cookie = await cartWith(book.id, 1);

  const [a, b] = await Promise.all([
    app.inject(withSession(cookie, { method: "POST", url: "/checkout", payload: delivery })),
    app.inject(withSession(cookie, { method: "POST", url: "/checkout", payload: delivery })),
  ]);

  const statuses = [a.statusCode, b.statusCode].sort();
  expect(statuses).toEqual([201, 422]);
  const detail = await app.inject({ method: "GET", url: `/books/${book.id}` });
  expect(detail.json().book.stock).toBe(4);
});
