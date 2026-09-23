import { fileURLToPath } from 'node:url';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, Exit, Option, Predicate, Result, Schema, pipe } from 'effect';
import { Command } from 'effect/unstable/cli';
import { depsFinder } from './cli/command.js';
import { readJsonFile } from './utils/file-reader.js';

const version = pipe(
  readJsonFile(Schema.Struct({ version: Schema.String }))(
    fileURLToPath(new URL('../package.json', import.meta.url)),
  ),
  Result.map((pkg) => pkg.version),
  Result.getOrElse(() => 'unknown'),
);

const exitCodeOf = <A, E>(exit: Exit.Exit<A, E>): number =>
  Exit.match(exit, {
    onSuccess: () => 0,
    onFailure: () =>
      Option.exists(Exit.findErrorOption(exit), Predicate.isTagged('IssuesFound')) ? 1 : 2,
  });

Command.run(depsFinder, { version }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({
    disableErrorReporting: true,
    // runMain calls process.exit on a non-zero code, which drops stdout Node has not flushed yet.
    teardown: (exit, onExit) => {
      process.exitCode = exitCodeOf(exit);
      onExit(0);
    },
  }),
);
