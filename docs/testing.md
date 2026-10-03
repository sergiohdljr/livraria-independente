# Testing the API

Manual checks against a running server, then the automated suite. Prices are integer cents. The session cookie is `session`.

## 1. Postgres

You need a database the app can migrate on startup. With the local Postgres user from `.env.example`:

```bash
psql "postgres://movielogger:movielogger@localhost:5432/postgres" -c "CREATE DATABASE livraria_independente;"
psql "postgres://movielogger:movielogger@localhost:5432/postgres" -c "CREATE DATABASE livraria_independente_test;"
```

`livraria_independente` is for the server. `livraria_independente_test` is for `npm test`. Ignore "already exists".

## 2. Install and start

```bash
npm install
cp .env.example .env
npm run dev
```

Defaults if you skip `.env`:

| Variable | Default |
| --- | --- |
| `DATABASE_URL` | `postgres://movielogger:movielogger@localhost:5432/livraria_independente` |
| `ADMIN_API_KEY` | `dev-admin-key` |
| `PORT` | `3000` |

Tables and two shipping ranges are created on boot.

| Postal code | Shipping |
| --- | --- |
| `01000000`–`05999999` | 1500 cents |
| `20000000`–`23799999` | 2500 cents |

`01310-100` is inside the first range. `99999-999` is not.

## 3. Walk the happy path

Use one cookie jar so the cart stays on the same session.

```bash
BASE=http://localhost:3000
KEY=dev-admin-key
rm -f /tmp/livraria-cookies.txt
```

Health:

```bash
curl -s "$BASE/health"
```

Expect `{"status":"ok"}`.

Create a book (admin). Copy `book.id` from the response into `BOOK`:

```bash
curl -s -X POST "$BASE/admin/books" \
  -H "content-type: application/json" \
  -H "x-api-key: $KEY" \
  -d '{"isbn":"9780000000100","title":"Barren Lives","author":"Graciliano Ramos","priceCents":2000,"stock":4}'

BOOK=<paste-id>
```

List and open it (no API key):

```bash
curl -s "$BASE/books"
curl -s "$BASE/books/$BOOK"
curl -s "$BASE/books?q=barren&available=true"
```

The same write without `x-api-key` must return `401` and `{"error":"unauthorized"}`.

Add two copies to the cart. `-c` stores the session cookie:

```bash
curl -s -c /tmp/livraria-cookies.txt -X POST "$BASE/cart/items" \
  -H "content-type: application/json" \
  -d "{\"bookId\":\"$BOOK\",\"quantity\":2}"
```

Expect `201` and `currentPriceCents` of `2000`. Quantity `2` is intent only: stock on `GET /books/$BOOK` is still `4`.

Change the quantity, then look at the cart:

```bash
curl -s -b /tmp/livraria-cookies.txt -X PATCH "$BASE/cart/items/$BOOK" \
  -H "content-type: application/json" \
  -d '{"quantity":1}'

curl -s -b /tmp/livraria-cookies.txt "$BASE/cart"
```

Put the quantity back to `2` before checkout if you want the totals below (`4000` + `1500` shipping).

Checkout. The server logs a line `order-confirmation to=...`:

```bash
curl -s -b /tmp/livraria-cookies.txt -X POST "$BASE/checkout" \
  -H "content-type: application/json" \
  -d '{"postalCode":"01310-100","address":"Rua Augusta, 100","email":"buyer@example.com"}'
```

Expect `201`, `order.status` of `"created"`, `payment.status` of `"accepted"`, `payment.amountCents` equal to `order.totalCents`, and `emailConfirmation` of `"sent"`. Each order line keeps `unitPriceCents` from checkout time.

Copy `order.id` into `ORDER`:

```bash
ORDER=<paste-id>
curl -s -b /tmp/livraria-cookies.txt "$BASE/orders/$ORDER"
curl -s -b /tmp/livraria-cookies.txt "$BASE/cart"
curl -s "$BASE/books/$BOOK"
```

The cart is empty. Stock is `2` if you checked out quantity `2` from stock `4`.

Change the catalog price. The order line stays at the old price:

```bash
curl -s -X PATCH "$BASE/admin/books/$BOOK" \
  -H "content-type: application/json" \
  -H "x-api-key: $KEY" \
  -d '{"priceCents":9000}'

curl -s -b /tmp/livraria-cookies.txt "$BASE/orders/$ORDER"
curl -s "$BASE/books/$BOOK"
```

## 4. Cases that must fail

Start a new cookie jar for each case (`rm -f /tmp/livraria-cookies.txt` and add the book to the cart again).

Declined payment. Header `x-payment-simulation: declined`. Expect `402` and `{"error":"payment_declined"}`. Stock and cart stay as they were. There is no payment method field in the body.

```bash
curl -s -b /tmp/livraria-cookies.txt -X POST "$BASE/checkout" \
  -H "content-type: application/json" \
  -H "x-payment-simulation: declined" \
  -d '{"postalCode":"01310-100","address":"Rua Augusta, 100","email":"buyer@example.com"}'
```

Postal code with no shipping range. Expect `422` and `{"error":"shipping_unavailable"}`.

```bash
curl -s -b /tmp/livraria-cookies.txt -X POST "$BASE/checkout" \
  -H "content-type: application/json" \
  -d '{"postalCode":"99999-999","address":"Rua Augusta, 100","email":"buyer@example.com"}'
```

Not enough stock. Add a quantity greater than `stock`. Expect `409` and `{"error":"insufficient_stock"}`.

Checkout with no session cookie. Expect `422` and `{"error":"empty_cart"}`.

```bash
curl -s -X POST "$BASE/checkout" \
  -H "content-type: application/json" \
  -d '{"postalCode":"01310-100","address":"Rua Augusta, 100","email":"buyer@example.com"}'
```

## 5. Automated tests

These hit the HTTP API and `livraria_independente_test`. They do not use the server you started with `npm run dev`.

```bash
npm test
npm run typecheck
```

`npm test` migrates that database and wipes books, carts, sessions, and orders between files. Shipping ranges stay. A passing run is 4 files and 13 tests.
