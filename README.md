# Livraria Independente

HTTP API for an independent bookstore: catalog, cart, checkout, and a fake payment. One Node process listens on `PORT`. Inside it, catalog, cart, and payment are separate Fastify servers on `127.0.0.1` with ephemeral ports. They share one Postgres database and keep separate schemas.

## Architecture

```text
Comprador / Admin
        │
        ▼
Checkout  :PORT          schema checkout     orders, shipping, email port
  │  proxies /books and /admin/books
  │  proxies /cart
  ├──────────────► Catalog   127.0.0.1:*    schema catalog      books, stock
  ├──────────────► Cart      127.0.0.1:*    schema cart         session, cart items
  └──────────────► Payment   127.0.0.1:*    schema payment      charges
```

Checkout is the only public host. It owns the order, the shipping quote, and the email port. Catalog, cart, and payment do not accept traffic from outside the process. Debit, restore, cart clear, and charge use `x-internal-key` and are not proxied.

Cart stores `book_id` with no foreign key to `catalog.books`. It asks catalog over HTTP for the current title and price. Payment is the only store of charge status and amount. The order keeps the total and the returned payment id.

Checkout holds a Postgres advisory lock on the session before it charges. The sequence is:

1. Read the cart, the books, and the shipping rate.
2. If the cart still has the same lines as an existing order for that session, return that order. Do not charge again.
3. Charge payment. A decline stops here: no order, stock unchanged, cart kept.
4. Debit every line in one catalog transaction. If that fails, there is no order and no refund.
5. Insert the order with the quoted prices and the payment id. If the insert fails, catalog restores the stock.
6. Clear the cart, then send the confirmation email. A failed clear or a failed email leaves the order in place.

Money is integer cents. The email adapter only logs `order-confirmation to=...`.

Decisions are in `docs/adr/`. Vocabulary is in `GLOSSARY.md`.

## Run

Requirements: Node 22 and Postgres. The app does not load a `.env` file. Unset variables fall back to the values in `.env.example`.

```bash
psql "postgres://movielogger:movielogger@localhost:5432/postgres" \
  -c "CREATE DATABASE livraria_independente" \
  -c "CREATE DATABASE livraria_independente_test"

npm install
npm run dev
```

`npm run dev` runs `tsx --watch src/server.ts`. Startup creates the four schemas and seeds shipping rates when the table is empty. The gateway listens on `0.0.0.0:3000`.

| Variable | Default |
| --- | --- |
| `DATABASE_URL` | `postgres://movielogger:movielogger@localhost:5432/livraria_independente` |
| `ADMIN_API_KEY` | `dev-admin-key` |
| `INTERNAL_API_KEY` | `dev-internal-key` |
| `PORT` | `3000` |

`npm run build` compiles to `dist/`. `npm start` runs `node dist/server.js`.

## Try a purchase

`docs/testing.md` walks the same API with more checks. Shipping is seeded for CEP `01000-000`–`05999-999` (R$ 15,00) and `20000-000`–`23799-999` (R$ 25,00). `01310-100` is inside the first range.

```bash
curl -s localhost:3000/health

curl -s -X POST localhost:3000/admin/books \
  -H 'content-type: application/json' \
  -H 'x-api-key: dev-admin-key' \
  -d '{"isbn":"9780000000001","title":"Example","author":"Author","priceCents":4500,"stock":3}'

# use the returned book.id
curl -s -c /tmp/livraria-cookies.txt -X POST localhost:3000/cart/items \
  -H 'content-type: application/json' \
  -d '{"bookId":"BOOK_ID","quantity":1}'

curl -s -b /tmp/livraria-cookies.txt -X POST localhost:3000/checkout \
  -H 'content-type: application/json' \
  -H 'x-payment-simulation: accepted' \
  -d '{"postalCode":"01310-100","address":"Rua Example 1","email":"buyer@example.com"}'
```

`x-payment-simulation: declined` stores a declined charge and leaves stock and the cart as they were. `99999-999` returns `shipping_unavailable`.

Public routes:

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | `{ "status": "ok" }` |
| `GET` | `/books?q=&available=true\|false` | proxied to catalog |
| `GET` | `/books/:id` | proxied to catalog |
| `POST` | `/admin/books` | header `x-api-key` |
| `PATCH` | `/admin/books/:id` | header `x-api-key` |
| `GET` | `/cart` | cookie `session` |
| `POST` | `/cart/items` | body `{ bookId, quantity }` |
| `PATCH` | `/cart/items/:bookId` | body `{ quantity }` |
| `DELETE` | `/cart/items/:bookId` | |
| `POST` | `/checkout` | cookie plus `{ postalCode, address, email }` |
| `GET` | `/orders/:id` | same session cookie |

Errors are `{ "error": "<code>" }`.

## Tests

```bash
npm test
npm run typecheck
```

Tests call the public gateway with Fastify `inject` and a real Postgres database, `livraria_independente_test`, unless `DATABASE_URL` is already set. Each run truncates books, carts, orders, and payments in that database. Point `DATABASE_URL` at the test database before `npm test` when your shell already exports the development URL.
