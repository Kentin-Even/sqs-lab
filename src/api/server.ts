import Fastify from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { config } from '../config.js';
import { sqs } from '../sqs.js';
import { pool, initDb } from '../db.js';

const OrderBody = z.object({
  customerId: z.string().min(1),
  amount: z.number().positive(),
});

const app = Fastify({ logger: true }); // pino intégré

app.post('/orders', async (req, reply) => {
  // 1. Validation
  const parsed = OrderBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ errors: parsed.error.flatten() });
  }
  const { customerId, amount } = parsed.data;

  // 2. Insertion PENDING
  const orderId = randomUUID();
  await pool.query(
    `INSERT INTO orders (id, customer_id, amount, status) VALUES ($1, $2, $3, 'PENDING')`,
    [orderId, customerId, amount],
  );

  // 3. Envoi du message (l'id seulement)
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: config.ordersQueueUrl,
      MessageBody: JSON.stringify({ orderId }),
    }),
  );

  // 4. 202 : accepté, pas encore traité
  return reply.code(202).send({ orderId });
});

await initDb();
await app.listen({ port: 3000, host: '0.0.0.0' });