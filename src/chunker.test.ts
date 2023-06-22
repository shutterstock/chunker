//chunker.test.ts
/// <reference types="jest" />
import * as kinesis from '@aws-sdk/client-kinesis';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { promisify } from 'util';
import { Chunker } from './chunker';

const sleep = promisify(setTimeout);

describe('Chunker', () => {
  const kinesisClient: AwsClientStub<kinesis.KinesisClient> = mockClient(kinesis.KinesisClient);
  const kinesisClientTyped: kinesis.KinesisClient =
    kinesisClient as unknown as kinesis.KinesisClient;

  beforeEach(() => {
    jest.resetAllMocks();
    kinesisClient.reset();
  });

  it('single item - does not write until flush is called', async () => {
    const chunker = new Chunker({
      countLimit: 2,
      sizeLimit: 100,
      sizer: (item: kinesis.PutRecordsRequestEntry): number => {
        const itemJSON = JSON.stringify(item);
        return itemJSON.length;
      },
      writer: async (records: kinesis.PutRecordsRequestEntry[]): Promise<void> => {
        await kinesisClientTyped.send(
          new kinesis.PutRecordsCommand({
            StreamName: 'some-stream',
            Records: records,
          }),
        );
      },
    });

    const record: kinesis.PutRecordsRequestEntry = {
      Data: Buffer.from('123', 'utf-8'),
      PartitionKey: '123',
    };
    kinesisClient
      .on(kinesis.PutRecordsCommand, { StreamName: 'some-stream', Records: [record] })
      .resolves({
        Records: [record as kinesis.PutRecordsResultEntry],
      });

    await chunker.enqueue(record);

    expect(kinesisClient.calls().length).toBe(0);

    await chunker.onIdle();

    expect(kinesisClient.calls().length).toBe(1);
  });

  it('two items - does not write until count exceeded', async () => {
    const chunker = new Chunker({
      countLimit: 2,
      sizeLimit: 100,
      sizer: (item: kinesis.PutRecordsRequestEntry): number => {
        const itemJSON = JSON.stringify(item);
        return itemJSON.length;
      },
      writer: async (records: kinesis.PutRecordsRequestEntry[]): Promise<void> => {
        await kinesisClientTyped.send(
          new kinesis.PutRecordsCommand({
            StreamName: 'some-stream',
            Records: records,
          }),
        );
      },
    });

    const record1: kinesis.PutRecordsRequestEntry = {
      Data: Buffer.from('123', 'utf-8'),
      PartitionKey: '123',
    };
    const record2: kinesis.PutRecordsRequestEntry = {
      Data: Buffer.from('456', 'utf-8'),
      PartitionKey: '456',
    };
    kinesisClient
      .onAnyCommand()
      .rejects()
      .on(kinesis.PutRecordsCommand, { StreamName: 'some-stream', Records: [record1] })
      .resolves({
        Records: [record1 as kinesis.PutRecordsResultEntry],
      })
      .on(kinesis.PutRecordsCommand, { StreamName: 'some-stream', Records: [record2] })
      .resolves({
        Records: [record2 as kinesis.PutRecordsResultEntry],
      });

    // First write should not flush
    await chunker.enqueue(record1);
    expect(kinesisClient.calls().length).toBe(0);
    expect(chunker.pendingCount).toBe(1);
    expect(chunker.pendingSize).toBe(65);

    // Second write should flush
    await chunker.enqueue(record2);
    expect(kinesisClient.calls().length).toBe(1);
    expect(chunker.pendingCount).toBe(0);
    expect(chunker.pendingSize).toBe(0);

    // Explicit flush should flush
    await chunker.onIdle();
    expect(kinesisClient.calls().length).toBe(2);
    expect(chunker.pendingCount).toBe(0);
    expect(chunker.pendingSize).toBe(0);
  });

  it('two items - does not write until size exceeded', async () => {
    const chunker = new Chunker({
      countLimit: 3,
      sizeLimit: 100,
      sizer: (item: kinesis.PutRecordsRequestEntry): number => {
        const itemJSON = JSON.stringify(item);
        return itemJSON.length;
      },
      writer: async (records: kinesis.PutRecordsRequestEntry[]): Promise<void> => {
        await kinesisClientTyped.send(
          new kinesis.PutRecordsCommand({
            StreamName: 'some-stream',
            Records: records,
          }),
        );
      },
    });

    const record1: kinesis.PutRecordsRequestEntry = {
      Data: Buffer.from('123', 'utf-8'),
      PartitionKey: '123',
    };
    const record2: kinesis.PutRecordsRequestEntry = {
      Data: Buffer.from('456', 'utf-8'),
      PartitionKey: '456',
    };
    const record3: kinesis.PutRecordsRequestEntry = {
      Data: Buffer.from('789', 'utf-8'),
      PartitionKey: '789',
    };
    kinesisClient
      .onAnyCommand()
      .rejects()
      .on(kinesis.PutRecordsCommand, { StreamName: 'some-stream', Records: [record1] })
      .resolves({
        Records: [record1 as kinesis.PutRecordsResultEntry],
      })
      .on(kinesis.PutRecordsCommand, { StreamName: 'some-stream', Records: [record2] })
      .resolves({
        Records: [record2 as kinesis.PutRecordsResultEntry],
      })
      .on(kinesis.PutRecordsCommand, { StreamName: 'some-stream', Records: [record3] })
      .resolves({
        Records: [record3 as kinesis.PutRecordsResultEntry],
      });

    // First write should not flush
    await chunker.enqueue(record1);
    expect(kinesisClient.calls().length).toBe(0);
    expect(chunker.pendingCount).toBe(1);
    expect(chunker.pendingSize).toBe(65);

    // Second write should flush
    await chunker.enqueue(record2);
    expect(kinesisClient.calls().length).toBe(1);
    expect(chunker.pendingCount).toBe(0);
    expect(chunker.pendingSize).toBe(0);

    // Explicit flush should flush
    await chunker.enqueue(record2);
    await chunker.onIdle();
    expect(kinesisClient.calls().length).toBe(3);
    expect(chunker.pendingCount).toBe(0);
    expect(chunker.pendingSize).toBe(0);
  });

  it('stress test - 100 writes in parallel into chunks of 25', async () => {
    const startTime = Date.now();
    const sink = jest.fn();
    type record = { message: string };
    const chunker = new Chunker({
      countLimit: 25,
      sizeLimit: 5 * 1024 * 1024,
      sizer: (item: record): number => {
        const itemJSON = JSON.stringify(item);
        return itemJSON.length;
      },
      writer: async (records: record[]): Promise<void> => {
        sink(records);
        await sleep(200);
      },
    });

    const writers: Promise<void>[] = [];
    for (let i = 0; i < 101; i++) {
      writers.push(chunker.enqueue({ message: `this is message ${i}` }));
    }

    await Promise.all(writers);

    expect(Date.now() - startTime).toBeGreaterThanOrEqual(4 * 200);

    expect(sink).toBeCalledTimes(4);
    expect(writers.length).toBe(101);

    await chunker.onIdle();

    expect(sink).toBeCalledTimes(5);
  });

  it('errors caught and exposed', async () => {
    const startTime = Date.now();
    type record = { message: string };
    const sink: (item: record[]) => Promise<void> = jest.fn().mockImplementation(async () => {
      await sleep(100);
      throw new Error('stop this now');
    });
    const chunker = new Chunker({
      countLimit: 25,
      sizeLimit: 5 * 1024 * 1024,
      sizer: (item: record): number => {
        const itemJSON = JSON.stringify(item);
        return itemJSON.length;
      },
      writer: sink,
    });

    for (let i = 0; i < 100; i++) {
      await chunker.enqueue({ message: `this is message ${i}` });
    }

    expect(chunker.errors.length).toBeGreaterThan(0);

    await chunker.onIdle();

    await chunker.onIdle();
    expect(chunker.errors.length).toBe(4);
    expect(chunker.errors[0]).toBeInstanceOf(Error);
    expect((chunker.errors[0] as Error).message).toBe('stop this now');

    expect(sink).toHaveBeenCalledTimes(4);
    expect(Date.now() - startTime).toBeGreaterThanOrEqual(4 * 100);
  });
});
