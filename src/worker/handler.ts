import { pool } from '../db.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type HandleResult = 'processed' | 'duplicate';

export async function handleOrder(orderId: string): Promise<HandleResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Test-and-set atomique : un seul gagnant, les autres obtiennent rowCount = 0
    const claim = await client.query(
      `INSERT INTO processed_messages (order_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [orderId],
    );
    if (claim.rowCount === 0) {
      await client.query('ROLLBACK');
      return 'duplicate'; // déjà traité : succès, le message sera supprimé
    }

    await sleep(1000);
    if (Math.random() < 0.3) throw new Error('random failure');

    await client.query(
      `UPDATE orders SET status = 'DONE' WHERE id = $1 AND status = 'PENDING'`,
      [orderId],
    );

    await client.query('COMMIT');
    return 'processed';
  } catch (err) {
    await client.query('ROLLBACK'); // le marqueur disparaît : le retry reste possible
    throw err;
  } finally {
    client.release();
  }
}