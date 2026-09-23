import { Array, Option, String, pipe } from 'effect';
import jsonc from 'jsonc-parser';
import type {
  FileContext,
  Gathered,
  ImportDetails,
  ImportType,
  PackageName,
} from '../domain/types.js';
import { buildLineStarts, lineNumberAt } from '../utils/line-index.js';
import {
  type TsConfig,
  type TsConfigChain,
  type TsConfigFile,
  extendsOf,
  readTsConfigChains,
} from '../utils/tsconfig-reader.js';
import { extractPackageName } from './import-parser.js';

type Use = {
  readonly packageName: PackageName;
  readonly importType: ImportType;
  readonly context: FileContext;
};

const lineOf = (text: string, at: jsonc.JSONPath): number =>
  pipe(
    Option.fromNullishOr(jsonc.parseTree(text)),
    Option.flatMap((tree) => Option.fromNullishOr(jsonc.findNodeAtLocation(tree, at))),
    Option.map((node) => lineNumberAt(buildLineStarts(text), node.offset)),
    Option.getOrElse(() => 1),
  );

const usageAt =
  (file: TsConfigFile, at: jsonc.JSONPath) =>
  (use: Use): ImportDetails => ({
    ...use,
    file: file.path,
    line: lineOf(file.text, at),
    importStatement: `"${at.join('.')}"`,
  });

const nearest = <A>(
  chain: TsConfigChain,
  pick: (config: TsConfig) => A | undefined,
): Option.Option<readonly [TsConfigFile, A]> =>
  Array.findFirst(chain, (file) =>
    Option.map(Option.fromUndefinedOr(pick(file.config)), (value) => [file, value] as const),
  );

const packageUses = (
  specifiers: ReadonlyArray<string>,
  importType: ImportType,
  context: FileContext,
): ReadonlyArray<Use> =>
  pipe(
    specifiers,
    Array.map(extractPackageName),
    Array.getSomes,
    Array.map((packageName) => ({ packageName, importType, context })),
  );

const INTO_NODE_MODULES = /node_modules[/\\]/;

// A relative path into node_modules extends the package it lands in.
const extendedSpecifier = (specifier: string): string =>
  Array.lastNonEmpty(String.split(INTO_NODE_MODULES)(specifier));

const extendsImports = (file: TsConfigFile): ReadonlyArray<ImportDetails> =>
  Array.map(
    packageUses(Array.map(extendsOf(file.config), extendedSpecifier), 'type-only', 'development'),
    usageAt(file, ['extends']),
  );

const typesImports = (chain: TsConfigChain): ReadonlyArray<ImportDetails> =>
  pipe(
    nearest(chain, (config) => config.compilerOptions?.types),
    Option.flatMap(([file, types]) =>
      Option.map(Option.fromNullOr(types), (listed) =>
        Array.map(
          packageUses(listed, 'type-only', 'development'),
          usageAt(file, ['compilerOptions', 'types']),
        ),
      ),
    ),
    Option.getOrElse((): ReadonlyArray<ImportDetails> => []),
  );

// Emitted code requires tslib for its helpers.
const helperImports = (chain: TsConfigChain): ReadonlyArray<ImportDetails> =>
  pipe(
    nearest(chain, (config) => config.compilerOptions?.importHelpers),
    Option.filter(([, importHelpers]) => importHelpers === true),
    Option.map(([file]) =>
      usageAt(file, ['compilerOptions', 'importHelpers'])({
        packageName: 'tslib',
        importType: 'runtime',
        context: 'production',
      }),
    ),
    Option.toArray,
  );

const importsOf = (chain: TsConfigChain): ReadonlyArray<ImportDetails> => [
  ...Array.flatMap(chain, extendsImports),
  ...typesImports(chain),
  ...helperImports(chain),
];

const sameUse = (a: ImportDetails, b: ImportDetails): boolean =>
  a.packageName === b.packageName && a.file === b.file && a.line === b.line;

export const readTsConfigImports = (projectRoot: string): Gathered<ImportDetails> => {
  const chains = readTsConfigChains(projectRoot);
  return {
    found: Array.dedupeWith(Array.flatMap(chains.found, importsOf), sameUse),
    skipped: chains.skipped,
  };
};
