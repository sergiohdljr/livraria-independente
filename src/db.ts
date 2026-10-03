import pg from "pg";

const { Pool } = pg;

export type Pool = pg.Pool;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS livros (
  id UUID PRIMARY KEY,
  isbn TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  autor TEXT NOT NULL,
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
  estoque INTEGER NOT NULL CHECK (estoque >= 0)
);

CREATE TABLE IF NOT EXISTS sessoes (
  id UUID PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS carrinhos (
  id UUID PRIMARY KEY,
  sessao_id UUID NOT NULL UNIQUE REFERENCES sessoes (id)
);

CREATE TABLE IF NOT EXISTS itens_carrinho (
  carrinho_id UUID NOT NULL REFERENCES carrinhos (id) ON DELETE CASCADE,
  livro_id UUID NOT NULL REFERENCES livros (id),
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  PRIMARY KEY (carrinho_id, livro_id)
);

CREATE TABLE IF NOT EXISTS faixas_frete (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cep_inicio INTEGER NOT NULL,
  cep_fim INTEGER NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0)
);

CREATE TABLE IF NOT EXISTS pedidos (
  id UUID PRIMARY KEY,
  sessao_id UUID NOT NULL REFERENCES sessoes (id),
  status TEXT NOT NULL,
  cep TEXT NOT NULL,
  endereco TEXT NOT NULL,
  email TEXT NOT NULL,
  frete_centavos INTEGER NOT NULL,
  total_centavos INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id UUID PRIMARY KEY,
  pedido_id UUID NOT NULL REFERENCES pedidos (id),
  livro_id UUID NOT NULL,
  isbn TEXT NOT NULL,
  titulo TEXT NOT NULL,
  autor TEXT NOT NULL,
  quantidade INTEGER NOT NULL,
  preco_unitario_centavos INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pagamentos (
  id UUID PRIMARY KEY,
  pedido_id UUID NOT NULL UNIQUE REFERENCES pedidos (id),
  status TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL
);
`;

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
  await pool.query(`
    INSERT INTO faixas_frete (cep_inicio, cep_fim, valor_centavos)
    SELECT * FROM (VALUES
      (1000000, 5999999, 1500),
      (20000000, 23799999, 2500)
    ) AS seed (cep_inicio, cep_fim, valor_centavos)
    WHERE NOT EXISTS (SELECT 1 FROM faixas_frete)
  `);
}

export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      pagamentos,
      itens_pedido,
      pedidos,
      itens_carrinho,
      carrinhos,
      sessoes,
      livros
    RESTART IDENTITY CASCADE
  `);
}
