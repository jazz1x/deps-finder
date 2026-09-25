import path from 'node:path';
import { Array, Match, Option, Order, Record, String, pipe } from 'effect';
import { type EmitSettings, type ImportElision, JsxRuntime } from '../domain/types.js';
import { lineage } from '../utils/project-walk.js';
import type { TsConfig, TsConfigChain } from '../utils/tsconfig-reader.js';

type JsxMode = NonNullable<NonNullable<TsConfig['compilerOptions']>['jsx']>;

// Without a jsx setting, today's bundlers compile JSX with the automatic runtime.
export const UNCONFIGURED: EmitSettings = {
  jsx: [JsxRuntime.Automatic({ importSource: 'react' })],
  elision: 'unused-bindings',
};

type Located<A> = { readonly dir: string; readonly value: A };

// The nearest file that sets the option decides; its null clears what it inherits. Paths in an
// option are relative to the file that sets it.
export const setWhere =
  <A>(pick: (config: TsConfig) => A | null | undefined) =>
  (chain: TsConfigChain): Option.Option<Located<A>> =>
    pipe(
      Array.findFirst(chain, (file) =>
        Option.map(Option.fromUndefinedOr(pick(file.config)), (value) => ({
          dir: path.dirname(file.path),
          value,
        })),
      ),
      Option.flatMap(({ dir, value }) =>
        Option.map(Option.fromNullOr(value), (set): Located<A> => ({ dir, value: set })),
      ),
    );

const setIn =
  <A>(pick: (config: TsConfig) => A | null | undefined) =>
  (chain: TsConfigChain): Option.Option<A> =>
    Option.map(setWhere(pick)(chain), ({ value }) => value);

// react-jsxdev imports <source>/jsx-dev-runtime instead of /jsx-runtime: the same package. A
// jsxImportSource selects the automatic runtime, without jsx or under preserve, as in tsc.
const jsxRuntimeOf = (chain: TsConfigChain): Option.Option<JsxRuntime> => {
  const importSource = setIn((config) => config.compilerOptions?.jsxImportSource)(chain);
  const automatic = () =>
    JsxRuntime.Automatic({ importSource: Option.getOrElse(importSource, () => 'react') });
  const factory = pipe(
    setIn((config) => config.compilerOptions?.jsxFactory)(chain),
    Option.map((set) => Array.headNonEmpty(String.split(set, '.'))),
    Option.getOrElse(() => 'React'),
  );
  return pipe(
    setIn((config) => config.compilerOptions?.jsx)(chain),
    Option.orElse((): Option.Option<JsxMode> => Option.as(importSource, 'react-jsx')),
    Option.map((mode: JsxMode) =>
      Match.value(mode).pipe(
        Match.when('react', () => JsxRuntime.Classic({ factory })),
        Match.whenOr('react-jsx', 'react-jsxdev', automatic),
        Match.whenOr('preserve', 'react-native', () =>
          Option.match(importSource, {
            onNone: () => JsxRuntime.Preserved({ factory }),
            onSome: automatic,
          }),
        ),
        Match.exhaustive,
      ),
    ),
  );
};

const keepsValueImports = (chain: TsConfigChain): boolean =>
  Array.some(
    [
      setIn((config) => config.compilerOptions?.verbatimModuleSyntax)(chain),
      setIn((config) => config.compilerOptions?.preserveValueImports)(chain),
      Option.map(
        setIn((config) => config.compilerOptions?.importsNotUsedAsValues)(chain),
        (mode) => mode !== 'remove',
      ),
    ],
    Option.contains(true),
  );

const elisionOf = (chain: TsConfigChain): ImportElision =>
  Match.value({
    keepsValueImports: keepsValueImports(chain),
    emitsMetadata: Option.contains(
      setIn((config) => config.compilerOptions?.emitDecoratorMetadata)(chain),
      true,
    ),
  }).pipe(
    Match.when({ keepsValueImports: true }, (): ImportElision => 'verbatim'),
    Match.when({ emitsMetadata: true }, (): ImportElision => 'decorator-metadata'),
    Match.orElse((): ImportElision => 'unused-bindings'),
  );

const toPosix = (file: string): string => file.split(path.sep).join('/');

const escapeSegment = (segment: string): string =>
  segment
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]');

// A tsconfig path pattern covers the file it names and everything under the directory it names.
const globOf =
  (dir: string) =>
  (pattern: string): RegExp =>
    new RegExp(
      `^${Array.map(toPosix(path.resolve(dir, pattern)).split('/'), (segment) =>
        segment === '**' ? '(?:[^/]+/)*' : `${escapeSegment(segment)}/`,
      ).join('')}`,
    );

const matchesAny = (patterns: Located<ReadonlyArray<string>>): ((file: string) => boolean) => {
  const globs = Array.map(patterns.value, globOf(patterns.dir));
  return (file) => Array.some(globs, (glob) => glob.test(`${toPosix(file)}/`));
};

// Without files or include, a tsconfig includes every file under its own directory.
const coverageOf = (chain: TsConfigChain): ((file: string) => boolean) => {
  const files = setWhere((config) => config.files)(chain);
  const listed = Option.match(files, {
    onNone: () => new globalThis.Set<string>(),
    onSome: ({ dir, value }) =>
      new globalThis.Set(Array.map(value, (file) => path.resolve(dir, file))),
  });
  const included = pipe(
    setWhere((config) => config.include)(chain),
    Option.orElse(() =>
      Option.match(files, {
        onNone: () => Option.some({ dir: path.dirname(headOf(chain)), value: ['**/*'] }),
        onSome: () => Option.none(),
      }),
    ),
    Option.match({ onNone: () => () => false, onSome: matchesAny }),
  );
  const excluded = Option.match(setWhere((config) => config.exclude)(chain), {
    onNone: () => () => false,
    onSome: matchesAny,
  });
  return (file) => listed.has(file) || (included(file) && !excluded(file));
};

type Governing<A> = {
  readonly head: string;
  readonly covers: (file: string) => boolean;
  readonly settings: A;
};

const headOf = (chain: TsConfigChain): string => Array.headNonEmpty(chain).path;

type Emit = { readonly jsx: Option.Option<JsxRuntime>; readonly elision: ImportElision };

const KEEPING: Record<ImportElision, number> = {
  'unused-bindings': 0,
  'decorator-metadata': 1,
  verbatim: 2,
};

const byKeeping = Order.mapInput(Order.Number, (elision: ImportElision) => KEEPING[elision]);

// A file that several tsconfig files compile gets every JSX runtime they set and the elision that
// keeps the most imports.
const merged = (governing: Array.NonEmptyReadonlyArray<Emit>): EmitSettings => ({
  jsx: Array.match(Array.dedupe(Array.getSomes(Array.map(governing, ({ jsx }) => jsx))), {
    onEmpty: () => UNCONFIGURED.jsx,
    onNonEmpty: (set) => set,
  }),
  elision: Array.max(
    Array.map(governing, ({ elision }) => elision),
    byKeeping,
  ),
});

// Among the tsconfig files of one directory, those whose files or include cover the file compile
// it; a file none covers falls to tsconfig.json, as tsc and bundlers do, else to all of them.
const governingFor =
  (file: string) =>
  <A>(
    group: Array.NonEmptyReadonlyArray<Governing<A>>,
  ): Array.NonEmptyReadonlyArray<Governing<A>> => {
    const preferred: ReadonlyArray<ReadonlyArray<Governing<A>>> = [
      Array.filter(group, (governing) => governing.covers(file)),
      Array.filter(group, (governing) => path.basename(governing.head) === 'tsconfig.json'),
    ];
    return pipe(
      Array.findFirst(preferred, Option.liftPredicate(Array.isReadonlyArrayNonEmpty)),
      Option.getOrElse(() => group),
    );
  };

// The tsconfig files of the nearest directory above a file that has any.
const nearestTsConfigs = <A>(
  chains: ReadonlyArray<readonly [TsConfigChain, A]>,
): ((file: string) => ReadonlyArray<Governing<A>>) => {
  const byDirectory = pipe(
    Array.sort(
      chains,
      Order.mapInput(Order.String, ([chain]: readonly [TsConfigChain, A]) => headOf(chain)),
    ),
    Array.groupBy(([chain]) => path.dirname(headOf(chain))),
    Record.map(
      Array.map(([chain, settings]): Governing<A> => ({
        head: headOf(chain),
        covers: coverageOf(chain),
        settings,
      })),
    ),
  );
  return (file) =>
    pipe(
      lineage(path.dirname(file)),
      Array.findFirst((dir) => Record.get(byDirectory, dir)),
      Option.getOrElse((): ReadonlyArray<Governing<A>> => []),
    );
};

const governedBy = <A>(
  chains: ReadonlyArray<readonly [TsConfigChain, A]>,
): ((file: string) => ReadonlyArray<A>) => {
  const nearest = nearestTsConfigs(chains);
  return (file) =>
    pipe(
      nearest(file),
      Array.match({ onEmpty: () => [], onNonEmpty: governingFor(file) }),
      Array.map(({ settings }) => settings),
    );
};

// tsc reads a file's specifiers through only the tsconfig files that compile it.
export const compiledBy = <A>(
  chains: ReadonlyArray<readonly [TsConfigChain, A]>,
): ((file: string) => ReadonlyArray<A>) => {
  const nearest = nearestTsConfigs(chains);
  return (file) =>
    pipe(
      nearest(file),
      Array.filter((governing) => governing.covers(file)),
      Array.map(({ settings }) => settings),
    );
};

export const emitSettingsOf = (
  chains: ReadonlyArray<TsConfigChain>,
): ((file: string) => EmitSettings) => {
  const governing = governedBy(
    Array.map(
      chains,
      (chain) => [chain, { jsx: jsxRuntimeOf(chain), elision: elisionOf(chain) }] as const,
    ),
  );
  return (file) =>
    Array.match(governing(file), { onEmpty: () => UNCONFIGURED, onNonEmpty: merged });
};
