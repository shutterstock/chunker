[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT) [![API Docs](https://img.shields.io/badge/API%20Docs-View%20Here-blue)](https://tech.shutterstock.com/chunker/) [![Build - CI](https://github.com/shutterstock/chunker/actions/workflows/ci.yml/badge.svg)](https://github.com/shutterstock/chunker/actions/workflows/ci.yml) [![Package and Publish](https://github.com/shutterstock/chunker/actions/workflows/publish.yml/badge.svg)](https://github.com/shutterstock/chunker/actions/workflows/publish.yml) [![Publish Docs](https://github.com/shutterstock/chunker/actions/workflows/docs.yml/badge.svg)](https://github.com/shutterstock/chunker/actions/workflows/docs.yml)

# Overview

`@shutterstock/chunker` calls a blocking async callback _before_ adding an item that would exceed a user-defined size limit OR when the count of items limit is reached.

A common use case for `@shutterstock/chunker` is as a "batch accumulator" that gathers up items to be processed in a batch where the batch has specific count and size constraints that must be followed.  For example, sending batches to an AWS Kinesis Data Stream requires that there be 500 or less records totalling 500 MB or less in size.  The record count part is easy, but the record size check and handling both is more difficult.

# Getting Started

## Installation

The package is available on npm as [@shutterstock/chunker](https://www.npmjs.com/package/@shutterstock/chunker)

`npm i @shutterstock/chunker`

## Importing

```typescript
import { Chunker } from '@shutterstock/chunker';
```

## API Documentation

After installing the package, you might want to look at our [API Documentation](https://tech.shutterstock.com/chunker/) to learn about all the features available.

# `Chunker`

`Chunker` has a `BlockingQueue` that it uses to store items until the size or count limits are reached.  When the limits are reached, the `Chunker` calls the user-provided callback with the items in the queue. The callback is expected to return a `Promise` that resolves when the items have been processed. The `Chunker` will wait for the `Promise` to resolve before continuing.

See below for an example of using `Chunker` to write batches of records to an AWS Kinesis Data Stream.

# Contributing

## Setting up Build Environment

- `nvm use`
- `npm i`
- `npm run build`
- `npm run lint`
- `npm run test`

## Running Examples

### aws-kinesis-writer

1. Create Kinesis Data Stream using AWS Console or any other method
   1. Default name is `chunker-test-stream`
   2. 1 shard is sufficient
   3. 1 day retention is sufficient
   4. No encryption is sufficient
   5. On-demand throughput is sufficient
2. `npm run example:aws-kinesis-writer`
   1. If the stream name was changed: `KINESIS_STREAM_NAME=my-stream-name npm run example:aws-kinesis-writer`
3. Observe in the log output that the `enqueue` method intermittently blocks when the count or size constraints would be breached.  During the block the records are written to the Kinesis Data Stream, after which the block is released and the new item is added to the next batch.
