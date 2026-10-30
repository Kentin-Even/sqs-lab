import { SQSClient } from '@aws-sdk/client-sqs';
import { config } from './config.js';

export const sqs = new SQSClient({ region: config.region });