import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id          UUID PRIMARY KEY,
      customer_id TEXT NOT NULL,
      amount      NUMERIC(12,2) NOT NULL,
      status      TEXT NOT NULL DEFAULT 'PENDING',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
  CREATE TABLE IF NOT EXISTS processed_messages (
    order_id     UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);
}
