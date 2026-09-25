import { fileURLToPath } from 'node:url';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Console, Effect, Exit, Layer, Match, Schema, pipe } from 'effect';
import { CliConfig, type CliError, CliOutput, Command, GlobalFlag } from 'effect/unstable/cli';
import { depsFinder } from './cli/command.js';
import { exitCodeOf } from './cli/exit-code.js';
import { stdoutColours } from './cli/terminal.js';
import type { FileError, RunOutcome } from './domain/errors.js';
import { formatFileError } from './reporters/error-reporter.js';
import { readJsonFile } from './utils/file-reader.js';

const readVersion = readJsonFile(Schema.Struct({ version: Schema.String }));

const reportFailure = (error: FileError | RunOutcome | CliError.CliError): Effect.Effect<void> =>
  Match.value(error).pipe(
    Match.tag('FileNotFound', 'ReadFailed', 'ParseFailed', (e) =>
      Console.error(formatFileError(e)),
    ),
    Match.orElse(() => Effect.void),
  );

const CliLayer = Layer.mergeAll(
  NodeServices.layer,
  CliConfig.layer({ builtIns: [GlobalFlag.Help, GlobalFlag.Version] }),
  CliOutput.layer(CliOutput.defaultFormatter({ colors: stdoutColours() })),
);

pipe(
  Effect.fromResult(readVersion(fileURLToPath(new URL('../package.json', import.meta.url)))),
  Effect.flatMap((pkg) => Command.run(depsFinder, { version: pkg.version })),
  Effect.tapError(reportFailure),
  Effect.tapDefect((defect) => Console.error(defect)),
  Effect.provide(CliLayer),
  NodeRuntime.runMain({
    disableErrorReporting: true,
    // runMain calls process.exit on a non-zero code, which drops stdout Node has not flushed yet.
    // It also exits with this code after a signal, so pass the real code only then.
    teardown: (exit, onExit) => {
      process.exitCode = exitCodeOf(exit);
      onExit(Exit.hasInterrupts(exit) ? process.exitCode : 0);
    },
  }),
);
