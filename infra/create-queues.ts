import { CreateQueueCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { config } from '../src/config.js';
import { sqs } from '../src/sqs.js';

// 1. DLQ d'abord
const dlq = await sqs.send(new CreateQueueCommand({ QueueName: config.queues.dlq }));
const dlqUrl = dlq.QueueUrl!;

// 2. Son ARN
const { Attributes } = await sqs.send(
  new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] }),
);
const dlqArn = Attributes!.QueueArn!;

// 3. Queue principale (les attributs SQS sont toujours des strings)
const main = await sqs.send(
  new CreateQueueCommand({
    QueueName: config.queues.main,
    Attributes: {
      VisibilityTimeout: '30',
      ReceiveMessageWaitTimeSeconds: '20',
      RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 3 }),
    },
  }),
);

console.log(`ORDERS_QUEUE_URL=${main.QueueUrl}`);
console.log(`ORDERS_DLQ_URL=${dlqUrl}`);