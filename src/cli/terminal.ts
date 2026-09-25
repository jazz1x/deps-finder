import { workerData } from 'node:worker_threads';
import { Option, Schema, pipe } from 'effect';

const FromMainThread = Schema.Struct({ stdoutIsTerminal: Schema.Boolean });

// A worker's stdout is a pipe to the main thread, so bin/cli.js says whether its own is a terminal.
export const isTerminalOf = (data: unknown, isTTY: boolean | undefined): boolean =>
  pipe(
    Schema.decodeUnknownOption(FromMainThread)(data),
    Option.map(({ stdoutIsTerminal }) => stdoutIsTerminal),
    Option.getOrElse(() => isTTY === true),
  );

export const coloursOn = (isTerminal: boolean, noColor: string | undefined): boolean =>
  isTerminal && (noColor ?? '') === '';

export const stdoutColours = (): boolean =>
  coloursOn(isTerminalOf(workerData, process.stdout.isTTY), process.env['NO_COLOR']);
