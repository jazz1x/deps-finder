import path from 'node:path';
import { Array, Match, Option, Order, Record, String, pipe } from 'effect';
import { type EmitSettings, type ImportElision, JsxRuntime } from '../domain/types.js';
import { lineage } from '../utils/project-walk.js';
import type { TsConfig, TsConfigChain } from '../utils/tsconfig-reader.js';

type JsxMode = NonNullable<NonNullable<TsConfig['compilerOptions']>['jsx']>;

export const UNCONFIGURED: EmitSettings = {
  jsx: JsxRuntime.Automatic({ importSource: 'react' }),
  elision: 'unused-bindings',
};

// The nearest file that sets the option decides; its null clears what it inherits.
const setIn =
  <A>(pick: (config: TsConfig) => A | null | undefined) =>
  (chain: TsConfigChain): Option.Option<A> =>
    pipe(
      Array.findFirst(chain, (file) => Option.fromUndefinedOr(pick(file.config))),
      Option.flatMap(Option.fromNullOr),
    );

const firstSet = <A>(
  chains: ReadonlyArray<TsConfigChain>,
  pick: (config: TsConfig) => A | null | undefined,
): Option.Option<A> => Array.findFirst(chains, setIn(pick));

// Without a jsx setting, today's bundlers compile JSX with the automatic runtime. react-jsxdev
// imports <source>/jsx-dev-runtime instead of /jsx-runtime: the same package.
const jsxRuntimeOf = (chains: ReadonlyArray<TsConfigChain>): JsxRuntime =>
  Match.value(
    Option.getOrElse(
      firstSet(chains, (config) => config.compilerOptions?.jsx),
      (): JsxMode => 'react-jsx',
    ),
  ).pipe(
    Match.when('react', () =>
      JsxRuntime.Classic({
        factory: pipe(
          firstSet(chains, (config) => config.compilerOptions?.jsxFactory),
          Option.map((factory) => Array.headNonEmpty(String.split(factory, '.'))),
          Option.getOrElse(() => 'React'),
        ),
      }),
    ),
    Match.whenOr('react-jsx', 'react-jsxdev', 'preserve', 'react-native', () =>
      JsxRuntime.Automatic({
        importSource: Option.getOrElse(
          firstSet(chains, (config) => config.compilerOptions?.jsxImportSource),
          () => 'react',
        ),
      }),
    ),
    Match.exhaustive,
  );

const keepsValueImports = (chains: ReadonlyArray<TsConfigChain>): boolean =>
  Array.some(
    [
      firstSet(chains, (config) => config.compilerOptions?.verbatimModuleSyntax),
      firstSet(chains, (config) => config.compilerOptions?.preserveValueImports),
      Option.map(
        firstSet(chains, (config) => config.compilerOptions?.importsNotUsedAsValues),
        (mode) => mode !== 'remove',
      ),
    ],
    Option.contains(true),
  );

const elisionOf = (chains: ReadonlyArray<TsConfigChain>): ImportElision =>
  Match.value({
    keepsValueImports: keepsValueImports(chains),
    emitsMetadata: Option.contains(
      firstSet(chains, (config) => config.compilerOptions?.emitDecoratorMetadata),
      true,
    ),
  }).pipe(
    Match.when({ keepsValueImports: true }, (): ImportElision => 'verbatim'),
    Match.when({ emitsMetadata: true }, (): ImportElision => 'decorator-metadata'),
    Match.orElse((): ImportElision => 'unused-bindings'),
  );

const settingsOf = (chains: ReadonlyArray<TsConfigChain>): EmitSettings => ({
  jsx: jsxRuntimeOf(chains),
  elision: elisionOf(chains),
});

const headOf = (chain: TsConfigChain): string => Array.headNonEmpty(chain).path;

// In one directory tsconfig.json speaks first, then the other tsconfig files by path.
const byPrecedence = Order.combine(
  Order.mapInput(
    Order.Boolean,
    (chain: TsConfigChain) => path.basename(headOf(chain)) !== 'tsconfig.json',
  ),
  Order.mapInput(Order.String, headOf),
);

// A file follows the tsconfig files of the nearest directory above it that has any.
export const emitSettingsOf = (
  chains: ReadonlyArray<TsConfigChain>,
): ((file: string) => EmitSettings) => {
  const byDirectory = pipe(
    Array.sort(chains, byPrecedence),
    Array.groupBy((chain) => path.dirname(headOf(chain))),
    Record.map(settingsOf),
  );
  return (file) =>
    pipe(
      lineage(path.dirname(file)),
      Array.findFirst((dir) => Record.get(byDirectory, dir)),
      Option.getOrElse(() => UNCONFIGURED),
    );
};
