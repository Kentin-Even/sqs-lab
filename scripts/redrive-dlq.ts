import {
  GetQueueAttributesCommand,
  StartMessageMoveTaskCommand,
  ListMessageMoveTasksCommand,
} from '@aws-sdk/client-sqs';
import { config } from '../src/config.js';
import { sqs } from '../src/sqs.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { Attributes } = await sqs.send(
  new GetQueueAttributesCommand({
    QueueUrl: config.ordersDlqUrl,
    AttributeNames: ['QueueArn', 'ApproximateNumberOfMessages'],
  }),
);
const sourceArn = Attributes!.QueueArn!;
console.log(`DLQ: ${sourceArn} (${Attributes!.ApproximateNumberOfMessages} messages)`);

// Sans DestinationArn : chaque message retourne dans sa queue d'origine
const { TaskHandle } = await sqs.send(
  new StartMessageMoveTaskCommand({ SourceArn: sourceArn, MaxNumberOfMessagesPerSecond: 5 }),
);
console.log(`Move task démarrée: ${TaskHandle}`);

while (true) {
  const { Results } = await sqs.send(
    new ListMessageMoveTasksCommand({ SourceArn: sourceArn, MaxResults: 1 }),
  );
  const t = Results?.[0]; // la plus récente en premier
  if (!t) break;
  console.log(
    `${t.Status} — déplacés: ${t.ApproximateNumberOfMessagesMoved ?? 0}/${t.ApproximateNumberOfMessagesToMove ?? '?'}`,
  );
  if (t.Status !== 'RUNNING' && t.Status !== 'CANCELLING') {
    if (t.FailureReason) console.error(`Échec: ${t.FailureReason}`);
    break;
  }
  await sleep(2000);
}