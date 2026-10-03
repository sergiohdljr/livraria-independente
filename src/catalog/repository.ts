import { randomUUID } from "node:crypto";
import type { Pool } from "../db.js";
import { AppError } from "../shared/errors.js";

export type Livro = {
  id: string;
  isbn: string;
  titulo: string;
  autor: string;
  precoCentavos: number;
  estoque: number;
};

type LivroRow = {
  id: string;
  isbn: string;
  titulo: string;
  autor: string;
  preco_centavos: number;
  estoque: number;
};

function toLivro(row: LivroRow): Livro {
  return {
    id: row.id,
    isbn: row.isbn,
    titulo: row.titulo,
    autor: row.autor,
    precoCentavos: row.preco_centavos,
    estoque: row.estoque,
  };
}

export type CriarLivroInput = {
  isbn: string;
  titulo: string;
  autor: string;
  precoCentavos: number;
  estoque: number;
};

export async function criarLivro(pool: Pool, input: CriarLivroInput): Promise<Livro> {
  const id = randomUUID();
  try {
    const result = await pool.query<LivroRow>(
      `INSERT INTO livros (id, isbn, titulo, autor, preco_centavos, estoque)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, isbn, titulo, autor, preco_centavos, estoque`,
      [id, input.isbn, input.titulo, input.autor, input.precoCentavos, input.estoque],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(500, "erro_interno");
    return toLivro(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(409, "isbn_ja_existe");
    throw error;
  }
}

export type AtualizarLivroInput = {
  titulo?: string;
  autor?: string;
  precoCentavos?: number;
  estoque?: number;
};

export async function atualizarLivro(
  pool: Pool,
  id: string,
  input: AtualizarLivroInput,
): Promise<Livro> {
  const result = await pool.query<LivroRow>(
    `UPDATE livros SET
       titulo = COALESCE($2, titulo),
       autor = COALESCE($3, autor),
       preco_centavos = COALESCE($4, preco_centavos),
       estoque = COALESCE($5, estoque)
     WHERE id = $1
     RETURNING id, isbn, titulo, autor, preco_centavos, estoque`,
    [id, input.titulo ?? null, input.autor ?? null, input.precoCentavos ?? null, input.estoque ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "livro_nao_encontrado");
  return toLivro(row);
}

export async function buscarLivro(pool: Pool, id: string): Promise<Livro> {
  const result = await pool.query<LivroRow>(
    `SELECT id, isbn, titulo, autor, preco_centavos, estoque FROM livros WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "livro_nao_encontrado");
  return toLivro(row);
}

export async function listarLivros(
  pool: Pool,
  filtro: { q?: string; disponivel?: boolean },
): Promise<Livro[]> {
  const termo = filtro.q?.trim() ? escapeLike(filtro.q.trim()) : null;
  const result = await pool.query<LivroRow>(
    `SELECT id, isbn, titulo, autor, preco_centavos, estoque
     FROM livros
     WHERE ($1::text IS NULL OR titulo ILIKE '%' || $1 || '%' OR autor ILIKE '%' || $1 || '%')
       AND ($2::boolean IS NULL OR ($2 = true AND estoque > 0) OR ($2 = false AND estoque = 0))
     ORDER BY titulo, id`,
    [termo, filtro.disponivel ?? null],
  );
  return result.rows.map(toLivro);
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
