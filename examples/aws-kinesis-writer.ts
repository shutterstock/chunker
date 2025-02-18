/* eslint-disable no-console */
import { KinesisClient, PutRecordsCommand, PutRecordsRequestEntry } from '@aws-sdk/client-kinesis';
import { Chunker } from '@shutterstock/chunker';

const kinesisClient = new KinesisClient({});
const { KINESIS_STREAM_NAME = 'chunker-test-stream', RECORDS_TO_WRITE = '1500' } = process.env;
const RECORDS_TO_WRITE_NUM = parseInt(RECORDS_TO_WRITE, 10);

async function main() {
  // AWS Kinesis payloads must have 500 or less items
  // and must be 5 MB or less in total size.
  // Chunker will call the callback when the metrics are
  // reached so we can flush the batch to Kinesis without
  // ever exceeding the limits.
  const chunker = new Chunker({
    countLimit: 500,
    // Only go up to 95% of the limit of the Kinesis payload size
    sizeLimit: 5 * 1024 * 1024 * 0.95,
    /**
     * Compute the item size
     * @param record The record to compute the size of
     * @returns
     */
    sizer: (record: { item: PutRecordsRequestEntry; index: number }): number => {
      const { item, index } = record;
      const itemJSON = JSON.stringify(item);
      // Return the real size of the record if below 500 items
      if (index < 500) {
        return itemJSON.length;
      }

      // Lie about the record size above 500 items
      // to force flushes based on size
      // Records will be between 500 KB and 1024 KB if count is 1000
      return index * 1024;
    },
    /**
     * Write the items to Kinesis when called
     * @param records The records to write
     * @returns The result of the Kinesis PutRecordsCommand
     */
    writer: async (records: { index: number; item: PutRecordsRequestEntry }[]): Promise<void> => {
      console.log(
        `Writing to Kinesis - Start - Records: ${records.length}, First Index: ${
          records[0].index
        }, Last Index: ${records[records.length - 1].index}`,
      );
      // Send the records in a batch since we know we will be under the batch limits
      await kinesisClient.send(
        new PutRecordsCommand({
          StreamName: KINESIS_STREAM_NAME,
          Records: records.map((record) => record.item),
        }),
      );
      console.log(
        `Writing to Kinesis - Done  - Records: ${records.length}, First Index: ${
          records[0].index
        }, Last Index: ${records[records.length - 1].index}`,
      );
    },
  });

  try {
    for (let i = 0; i < RECORDS_TO_WRITE_NUM; i++) {
      const niceNumberStr = `${i.toString().padStart(5, '0')}`;
      const partitionKey = `${(i % 100).toString().padStart(5, '0')}`;
      const record: PutRecordsRequestEntry = {
        Data: Buffer.from(niceNumberStr, 'utf-8'),
        PartitionKey: partitionKey,
      };

      console.log(
        `Writing to Chunker - Start - Record: ${i}, Data: ${niceNumberStr}, PartitionKey: ${partitionKey}`,
      );
      const start = Date.now();
      await chunker.enqueue({ item: record, index: i });
      console.log(
        `Writing to Chunker - Done  - Record: ${i}, Data: ${niceNumberStr}, PartitionKey: ${partitionKey}, Duration: ${
          Date.now() - start
        } ms`,
      );
    }
  } finally {
    console.log('Waiting for Chunker to finish - Start');
    await chunker.onIdle();
    console.log('Waiting for Chunker to finish - Done');
  }
}

void main();
