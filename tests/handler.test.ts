import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initDb, pool } from '../src/db.js';
import { handleOrder } from '../src/worker/handler.js';

// Nécessite PostgreSQL (docker compose up -d) et DATABASE_URL dans .env
const ids: string[] = [];

async function createOrder(): Promise<string> {
  const id = randomUUID();
  ids.push(id);
  await pool.query(
    `INSERT INTO orders (id, customer_id, amount) VALUES ($1, 'test', 10)`,
    [id],
  );
  return id;
}

const status = async (id: string) =>
  (await pool.query(`SELECT status FROM orders WHERE id = $1`, [id])).rows[0].status;

const markers = async (id: string) =>
  (await pool.query(`SELECT count(*)::int AS n FROM processed_messages WHERE order_id = $1`, [id]))
    .rows[0].n;

beforeAll(initDb);

afterEach(async () => {
  vi.restoreAllMocks();
  await pool.query(`DELETE FROM processed_messages WHERE order_id = ANY($1)`, [ids]);
  await pool.query(`DELETE FROM orders WHERE id = ANY($1)`, [ids]);
  ids.length = 0;
});

afterAll(() => pool.end());

describe('handleOrder', () => {
  it('est idempotent : deux appels avec le même message → un seul effet', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // pas d'échec aléatoire
    const id = await createOrder();

    expect(await handleOrder(id)).toBe('processed');
    expect(await handleOrder(id)).toBe('duplicate');

    expect(await status(id)).toBe('DONE');
    expect(await markers(id)).toBe(1);
  });

  it("lève une erreur en cas d'échec : rollback, donc le message ne sera pas supprimé", async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // échec aléatoire forcé
    const id = await createOrder();

    await expect(handleOrder(id)).rejects.toThrow('random failure');

    expect(await status(id)).toBe('PENDING');
    expect(await markers(id)).toBe(0); // le retry reste possible
  });
});