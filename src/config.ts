import 'dotenv/config'; 

export const config = {
  region: process.env.AWS_REGION ?? 'eu-west-3',
  queues: { main: 'orders-queue', dlq: 'orders-dlq' },
  ordersQueueUrl: process.env.ORDERS_QUEUE_URL ?? '',
  ordersDlqUrl: process.env.ORDERS_DLQ_URL ?? '',
  databaseUrl: process.env.DATABASE_URL ?? '',
};