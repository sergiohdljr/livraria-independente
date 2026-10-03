import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { adminApiKey, createBook, startApp } from "./helpers.js";

let app: FastifyInstance;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ app, close } = await startApp());
});

afterAll(async () => {
  await close();
});

test("an admin with an API key creates a book and a buyer can list and open it", async () => {
  const created = await createBook(app, {
    isbn: "9780000000001",
    title: "Dom Casmurro",
    author: "Machado de Assis",
    priceCents: 4500,
    stock: 3,
  });

  const list = await app.inject({ method: "GET", url: "/books" });
  expect(list.statusCode).toBe(200);
  expect(list.json().books).toContainEqual({
    id: created.id,
    isbn: "9780000000001",
    title: "Dom Casmurro",
    author: "Machado de Assis",
    priceCents: 4500,
    stock: 3,
  });

  const detail = await app.inject({ method: "GET", url: `/books/${created.id}` });
  expect(detail.statusCode).toBe(200);
  expect(detail.json().book.stock).toBe(3);
});

test("creating a book without an API key is rejected", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/admin/books",
    payload: {
      isbn: "9780000000002",
      title: "No key",
      author: "Nobody",
      priceCents: 1000,
      stock: 1,
    },
  });

  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({ error: "unauthorized" });
});

test("an admin updates title, price, and stock", async () => {
  const book = await createBook(app, { isbn: "9780000000003", title: "Old title", stock: 2 });

  const updated = await app.inject({
    method: "PATCH",
    url: `/admin/books/${book.id}`,
    headers: { "x-api-key": adminApiKey },
    payload: { title: "New title", priceCents: 2200, stock: 9 },
  });

  expect(updated.statusCode).toBe(200);
  expect(updated.json().book).toMatchObject({
    title: "New title",
    priceCents: 2200,
    stock: 9,
  });

  const withoutKey = await app.inject({
    method: "PATCH",
    url: `/admin/books/${book.id}`,
    payload: { stock: 0 },
  });
  expect(withoutKey.statusCode).toBe(401);

  const detail = await app.inject({ method: "GET", url: `/books/${book.id}` });
  expect(detail.json().book.stock).toBe(9);
});

test("a buyer can search by text and filter by availability", async () => {
  await createBook(app, { isbn: "9780000000010", title: "A Hora da Estrela", author: "Lispector", stock: 0 });
  await createBook(app, { isbn: "9780000000011", title: "Estrela da manhã", author: "Bandeira", stock: 4 });
  await createBook(app, { isbn: "9780000000012", title: "Grande Sertão", author: "Rosa", stock: 1 });

  const search = await app.inject({ method: "GET", url: "/books?q=estrela" });
  expect(search.statusCode).toBe(200);
  const titles = search.json().books.map((book: { title: string }) => book.title);
  expect(titles).toEqual(["A Hora da Estrela", "Estrela da manhã"]);

  const available = await app.inject({ method: "GET", url: "/books?q=estrela&available=true" });
  expect(available.json().books.map((book: { title: string }) => book.title)).toEqual([
    "Estrela da manhã",
  ]);
});
