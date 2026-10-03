import { randomUUID } from "node:crypto";
import type { Pool } from "../db.js";
import { AppError } from "../shared/errors.js";

export type Book = {
  id: string;
  isbn: string;
  title: string;
  author: string;
  priceCents: number;
  stock: number;
};

export type NewBook = {
  isbn: string;
  title: string;
  author: string;
  priceCents: number;
  stock: number;
};

export type BookPatch = {
  title?: string;
  author?: string;
  priceCents?: number;
  stock?: number;
};

type BookRow = {
  id: string;
  isbn: string;
  title: string;
  author: string;
  price_cents: number;
  stock: number;
};

const COLUMNS = "id, isbn, title, author, price_cents, stock";

function toBook(row: BookRow): Book {
  return {
    id: row.id,
    isbn: row.isbn,
    title: row.title,
    author: row.author,
    priceCents: row.price_cents,
    stock: row.stock,
  };
}

export async function createBook(pool: Pool, input: NewBook): Promise<Book> {
  try {
    const result = await pool.query<BookRow>(
      `INSERT INTO catalog.books (id, isbn, title, author, price_cents, stock)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [randomUUID(), input.isbn, input.title, input.author, input.priceCents, input.stock],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(500, "internal_error");
    return toBook(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(409, "isbn_already_exists");
    throw error;
  }
}

export async function updateBook(pool: Pool, id: string, patch: BookPatch): Promise<Book> {
  const result = await pool.query<BookRow>(
    `UPDATE catalog.books SET
       title = COALESCE($2, title),
       author = COALESCE($3, author),
       price_cents = COALESCE($4, price_cents),
       stock = COALESCE($5, stock)
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, patch.title ?? null, patch.author ?? null, patch.priceCents ?? null, patch.stock ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "book_not_found");
  return toBook(row);
}

export async function getBook(pool: Pool, id: string): Promise<Book> {
  const result = await pool.query<BookRow>(
    `SELECT ${COLUMNS} FROM catalog.books WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "book_not_found");
  return toBook(row);
}

export async function listBooks(
  pool: Pool,
  filter: { query?: string; available?: boolean },
): Promise<Book[]> {
  const term = filter.query?.trim() ? escapeLike(filter.query.trim()) : null;
  const result = await pool.query<BookRow>(
    `SELECT ${COLUMNS}
     FROM catalog.books
     WHERE ($1::text IS NULL OR title ILIKE '%' || $1 || '%' OR author ILIKE '%' || $1 || '%')
       AND ($2::boolean IS NULL OR ($2 = true AND stock > 0) OR ($2 = false AND stock = 0))
     ORDER BY title, id`,
    [term, filter.available ?? null],
  );
  return result.rows.map(toBook);
}

export type StockLine = { bookId: string; quantity: number };

export async function debitStock(pool: Pool, lines: StockLine[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const line of lines) {
      const result = await client.query(
        `UPDATE catalog.books SET stock = stock - $2 WHERE id = $1 AND stock >= $2`,
        [line.bookId, line.quantity],
      );
      if (result.rowCount !== 1) throw new AppError(409, "insufficient_stock");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function restoreStock(pool: Pool, lines: StockLine[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const line of lines) {
      const result = await client.query(
        `UPDATE catalog.books SET stock = stock + $2 WHERE id = $1`,
        [line.bookId, line.quantity],
      );
      if (result.rowCount !== 1) throw new AppError(404, "book_not_found");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
