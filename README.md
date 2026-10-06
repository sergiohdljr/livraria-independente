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

`POST /checkout` locks the session, then talks to the other services over HTTP. The lock is released when that request finishes.

```mermaid
sequenceDiagram
    actor Buyer
    participant Checkout
    participant Cart
    participant Catalog
    participant Payment

    Buyer->>Checkout: POST /checkout
    Checkout->>Checkout: pg_advisory_lock(session)
    Checkout->>Checkout: read shipping rate
    Checkout->>Cart: GET /internal/carts/:sessionId
    Cart-->>Checkout: bookId, quantity
    loop each line
        Checkout->>Catalog: GET /books/:id
        Catalog-->>Checkout: price, stock
    end
    Checkout->>Payment: POST /internal/charges
    Payment-->>Checkout: accepted, id
    Checkout->>Catalog: POST /internal/stock/debit
    Checkout->>Checkout: insert order with quoted prices
    Checkout->>Cart: DELETE /internal/carts/:sessionId
    Checkout->>Checkout: log order confirmation
    Checkout-->>Buyer: 201 order
    Checkout->>Checkout: pg_advisory_unlock(session)
```

A failed cart clear or a failed email still returns the order. A debit that fails after an accepted charge does not refund. If the order insert fails and the stock restore also fails, the response is `500` and the log says stock was debited with no order.

Money is integer cents. The email adapter only logs `order-confirmation to=...`.

Decisions are in `docs/adr/`. Vocabulary is in `GLOSSARY.md`.

## Run

Requirements: Docker, and Node 22 on the host for the test suite. The app does not load a `.env` file. Unset variables fall back to the values in `.env.example`.

```bash
docker compose up --build
```

The Compose project `livraria-independente` starts Postgres 16 and the dev gateway (`tsx --watch`). Postgres is published on `localhost:5433`. The gateway listens on `0.0.0.0:3000`. Inside the Compose network the app uses host `postgres` and port 5432.

The first boot creates `livraria_independente` and `livraria_independente_test`, owned by role `livraria` with password `livraria`. Startup creates the four schemas and seeds shipping rates when the table is empty.

| Variable | Host fallback | `app` service |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://livraria:livraria@localhost:5433/livraria_independente` | `postgres://livraria:livraria@postgres:5432/livraria_independente` |
| `ADMIN_API_KEY` | `dev-admin-key` | `dev-admin-key` |
| `INTERNAL_API_KEY` | `dev-internal-key` | `dev-internal-key` |
| `PORT` | `3000` | `3000` |

Postgres data stays in the named volume `livraria-independente-pg`. `docker compose down -v` drops it, including both databases. After a `package-lock.json` change, rebuild the image and recreate the app's `node_modules` volume:

```bash
docker compose rm -sfv app
docker compose build app
docker compose up
```

`npm run build` compiles to `dist/`. `npm start` runs `node dist/server.js` on the host, using the host fallback URL.

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
npm install
npm test
npm run typecheck
```

Tests call the public gateway with Fastify `inject` and a real Postgres database, `livraria_independente_test` on `localhost:5433`, unless `DATABASE_URL` is already set. Start the Compose Postgres first. Each run truncates books, carts, orders, and payments in that database. Point `DATABASE_URL` at the test database before `npm test` when your shell already exports the development URL.
