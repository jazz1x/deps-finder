#!/usr/bin/env node
import { constants } from 'node:os';
import { Worker } from 'node:worker_threads';
import { MESSAGES } from '../dist/constants/messages.js';

// oxc parses on the native stack of the calling thread, and the main thread's is fixed by
// `ulimit -s` (8 MB: a segfault past 5,500 nested arrays). A worker's stack is sized here.
const worker = new Worker(new URL('../dist/index.js', import.meta.url), {
  argv: process.argv.slice(2),
  workerData: { stdoutIsTerminal: process.stdout.isTTY === true },
  resourceLimits: { stackSizeMb: 256 },
});

// The worker's output is written here, and a write can fail after the worker has exited. A reader
// that closed early (EPIPE) keeps the run's code; any other failure lost the report, a failed run.
const writeErrors = [];
process.stdout.on('error', (error) => writeErrors.push(error));
process.once('exit', () => {
  const lost = writeErrors.filter((error) => error.code !== 'EPIPE');
  lost.forEach((error) => process.stderr.write(`${MESSAGES.REPORT_NOT_WRITTEN(error.message)}\n`));
  process.exitCode = lost.length > 0 ? 2 : process.exitCode;
});

// A worker receives no signals and may be deep in a synchronous parse, so a signal ends it.
process.exitCode = await new Promise((resolve) => {
  worker.on('exit', resolve);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      resolve(128 + constants.signals[signal]);
      void worker.terminate();
    });
  }
});
