#!/usr/bin/env node
import { constants } from 'node:os';
import { Worker } from 'node:worker_threads';

// oxc parses on the native stack of the calling thread, and the main thread's is fixed by
// `ulimit -s` (8 MB: a segfault past 5,500 nested arrays). A worker's stack is sized here.
const worker = new Worker(new URL('../dist/index.js', import.meta.url), {
  argv: process.argv.slice(2),
  resourceLimits: { stackSizeMb: 256 },
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
