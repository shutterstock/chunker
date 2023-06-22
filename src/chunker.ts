import { IterableQueue } from '@shutterstock/p-map-iterable';

/**
 * Function that returns the user-defined size of an item
 *
 * @param item Item to have size computed
 * @returns User-defined size of item
 * @template T Type of item to have size computed
 */
export type SizerFunc<T> = (item: T) => Promise<number> | number;

/**
 * Function that writes items to a destination
 *
 * @param items Items to be written
 * @returns Result of writing items
 * @template T Type of items to be written
 */
export type WriterFunc<T> = (items: T[]) => Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Errors = (string | { [key: string]: any } | Error)[];

/**
 * Collects items up to `countLimit`, calling `writer` before `sizeLimit` would be exceeded.
 *
 * @remarks
 *
 * Always call {@link onIdle} when done to ensure that the last `writer` call is made.
 *
 * @template T Type of items to be chunked
 */
export class Chunker<T> {
  private readonly _writer: WriterFunc<T>;
  private readonly _iterableQueue: IterableQueue<T> = new IterableQueue<T>({ maxUnread: 0 });
  private readonly _errors: Errors = [];
  private _pendingSize = 0;
  private _pendingItems: T[] = [];
  private readonly _backgroundWriter: Promise<void>;

  /**
   * Creates a new Chunker instance
   *
   * @template T Type of items to be chunked
   * @template TResult Type of result returned by `writer`
   * @param options Chunker options
   * @param options.sizeLimit user-defined size before which `writer` should be called
   * @param options.countLimit number of pending items requiring that `writer` be called
   * @param options.sizer function that returns user-defined size of an item
   * @param options.writer function that writes the pending items when `sizeLimit` or `countLimit`
   *    would be exceeded.
   *    This is not a `mapper` as it does not return a result at all.
   *    If the results need to be passed along, add them to an `IterableQueueMapper` for example.
   */
  constructor(options: {
    sizeLimit: number;
    countLimit: number;
    sizer: SizerFunc<T>;
    writer: WriterFunc<T>;
  }) {
    const { sizeLimit, countLimit, sizer, writer } = options;

    this._writer = writer;

    // Start the background flushing process
    this._backgroundWriter = (async () => {
      for await (const item of this._iterableQueue) {
        // Get size of new item
        const size = await sizer(item);

        // Check if we need to flush before adding
        if (
          this._pendingItems.length === countLimit ||
          (this._pendingSize > 0 && this._pendingSize + size > sizeLimit)
        ) {
          await this.flush();
        }

        // Add the new item to the queue
        this._pendingItems.push(item);
        this._pendingSize += size;

        // Check if we need to flush after adding
        if (this._pendingItems.length === countLimit) {
          await this.flush();
        }
      }

      // Final flush if any items are left
      if (this._pendingItems.length > 0) {
        await this.flush();
      }
    })();
  }

  /**
   * Sum of the user-defined size of all pending items
   */
  public get pendingSize(): number {
    return this._pendingSize;
  }

  /**
   * Number of items pending
   */
  public get pendingCount(): number {
    return this._pendingItems.length;
  }

  /**
   * Accumulated errors from background flushes
   */
  public get errors(): Errors {
    return this._errors;
  }

  /**
   * Wait for all background writes to finish.
   * MUST be called before exit to ensure no lost writes.
   */
  public async onIdle(): Promise<void> {
    // Indicate that we're done writing requests
    this._iterableQueue.done();

    // Wait for the background writer to exit
    await this._backgroundWriter;
  }

  /**
   * Calls `writer` for any pending items and clears pending items queue.
   * @returns Result from `writer` function or `undefined` if no items pending
   */
  private async flush(): Promise<void> {
    const itemsToWrite = this._pendingItems;
    this._pendingItems = [];
    this._pendingSize = 0;
    if (itemsToWrite.length === 0) {
      return undefined;
    } else {
      try {
        await this._writer(itemsToWrite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        this._errors.push(error);
      }
    }
  }

  /**
   * Adds an item to the pending queue, flushing the queue before
   * adding the item if the new item would cause the item limit
   * or size limit to be exceeded.
   *
   * @param item Item to be added to the queue
   */
  public async enqueue(item: T): Promise<void> {
    await this._iterableQueue.enqueue(item);
  }
}
