import { DeleteQueueCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { config } from '../src/config.js';
import { sqs } from '../src/sqs.js';

// Ordre inverse de la création : la queue source d'abord, puis la DLQ
for (const name of [config.queues.main, config.queues.dlq]) {
  try {
    const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    await sqs.send(new DeleteQueueCommand({ QueueUrl }));
    console.log(`deleted ${name}`);
  } catch (e) {
    if ((e as Error).name === 'QueueDoesNotExist') console.log(`${name}: already gone`);
    else throw e;
  }
}