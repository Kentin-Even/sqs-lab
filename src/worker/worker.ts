import pino from 'pino';
import { z } from 'zod';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import { config } from '../config.js';
import { sqs } from '../sqs.js';
import { handleOrder } from './handler.js';

const log = pino({ name: 'worker' });
const Body = z.object({ orderId: z.string().uuid() });

let running = true;
const pollAbort = new AbortController();

function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  running = false;
  pollAbort.abort(); // interrompt uniquement le long poll en attente
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function processMessage(m: Message): Promise<void> {
  const start = Date.now();
  const receiveCount = Number(m.Attributes?.ApproximateReceiveCount ?? 0);
  try {
    const { orderId } = Body.parse(JSON.parse(m.Body ?? ''));
    const result = await handleOrder(orderId);
    log.info({ orderId, messageId: m.MessageId, receiveCount, durationMs: Date.now() - start, outcome: result });
  } catch (err) {
    log.warn({ messageId: m.MessageId, receiveCount, durationMs: Date.now() - start, outcome: 'failure', err: (err as Error).message });
    throw err; // remonte l'échec : le message ne sera pas supprimé
  }
}

async function deleteMessage(m: Message) {
  try {
    await sqs.send(new DeleteMessageCommand({
      QueueUrl: config.ordersQueueUrl,
      ReceiptHandle: m.ReceiptHandle!,
    }));
  } catch (err) {
    log.error({ messageId: m.MessageId, err: (err as Error).message }, 'delete failed');
  }
}

while (running) {
  let messages: Message[];
  try {
    const res = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: config.ordersQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
      { abortSignal: pollAbort.signal },
    );
    messages = res.Messages ?? [];
  } catch (err) {
    if (!running) break; // abort volontaire
    log.error({ err: (err as Error).message }, 'receive failed');
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }

  // Le lot en cours est toujours traité en entier, même après un signal
  const results = await Promise.allSettled(messages.map(processMessage));
  await Promise.all(
    messages.map((message, i) =>
      results[i]?.status === 'fulfilled' ? deleteMessage(message) : undefined,
    ),
  );
}

log.info('worker stopped');
process.exit(0);