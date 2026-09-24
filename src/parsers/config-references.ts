import path from 'node:path';
import type {
  ArrayExpressionElement,
  ObjectExpression,
  ObjectPropertyKind,
  Program,
} from '@oxc-project/types';
import {
  Array,
  Data,
  Match,
  Option,
  Predicate,
  Record,
  Result,
  Schema,
  String,
  pipe,
} from 'effect';
import YAML from 'yaml';
import type { FileError } from '../domain/errors.js';
import {
  type Gathered,
  type ImportDetails,
  type PackageName,
  type ScriptCommand,
  developmentUse,
} from '../domain/types.js';
import {
  decodeJsonc,
  decodeYamlDocument,
  gatherAll,
  gatherOptional,
  readDirectory,
  readFile,
} from '../utils/file-reader.js';
import { collectVisiting, extractPackageName, parse } from './import-parser.js';
import type { LayoutManifest, ToolKey } from './package-parser.js';

type KnownTool =
  | 'eslint'
  | 'babel'
  | 'postcss'
  | 'jest'
  | 'prettier'
  | 'stylelint'
  | 'commitlint'
  | 'storybook'
  | 'serverless'
  | 'nx';

// lint-staged: its values are commands. other: any root config, where only a string that is
// exactly a package name counts.
type Tool = KnownTool | 'lint-staged' | 'other';

// Paths relative to a layout root; the first match wins.
const CONFIG_FILES: ReadonlyArray<readonly [RegExp, Tool]> = [
  [/^\.eslintrc(?:\.(?:json|ya?ml|c?js))?$/, 'eslint'],
  [/^(?:\.babelrc(?:\.(?:json|[cm]?js|cts))?|babel\.config\.(?:json|[cm]?[jt]s))$/, 'babel'],
  [/^(?:postcss\.config\.[cm]?[jt]s|\.postcssrc(?:\.(?:json|ya?ml|[cm]?[jt]s))?)$/, 'postcss'],
  [/^jest\.config\.(?:json|[cm]?[jt]s)$/, 'jest'],
  [/^(?:\.prettierrc(?:\.(?:json|ya?ml|[cm]?[jt]s))?|prettier\.config\.[cm]?[jt]s)$/, 'prettier'],
  [
    /^(?:\.stylelintrc(?:\.(?:json|ya?ml|[cm]?[jt]s))?|stylelint\.config\.[cm]?[jt]s)$/,
    'stylelint',
  ],
  [
    /^(?:\.commitlintrc(?:\.(?:json|ya?ml|[cm]?[jt]s))?|commitlint\.config\.[cm]?[jt]s)$/,
    'commitlint',
  ],
  [/^\.storybook\/main\.[cm]?[jt]s$/, 'storybook'],
  [/^serverless\.(?:ya?ml|json|[cm]?[jt]s)$/, 'serverless'],
  [
    /^(?:\.lintstagedrc(?:\.(?:json|ya?ml|[cm]?js))?|lint-staged\.config\.[cm]?[jt]s)$/,
    'lint-staged',
  ],
  [/^(?:project|nx)\.json$/, 'nx'],
  [/^[^/]+\.(?:config|preset)\.(?:[^/]+\.)?[cm]?[jt]sx?$/, 'other'],
  // Manifests and lockfiles list what is installed, not what is used; tsconfigs are read on their own.
  [
    /^(?!package(?:-lock)?\.json$|npm-shrinkwrap\.json$|pnpm-(?:lock|workspace)\.yaml$|[jt]sconfig(?:\.[^/]+)?\.json$)[^/]+\.(?:jsonc?|ya?ml)$/,
    'other',
  ],
];

const PACKAGE_JSON_TOOLS: Readonly<Record<ToolKey, Tool>> = {
  eslintConfig: 'eslint',
  babel: 'babel',
  postcss: 'postcss',
  jest: 'jest',
  prettier: 'prettier',
  stylelint: 'stylelint',
  commitlint: 'commitlint',
  'lint-staged': 'lint-staged',
};

// A config value, narrowed once from JSON, YAML or a JS literal. Opaque: anything else.
type Value = Data.TaggedEnum<{
  Text: { readonly text: string };
  List: { readonly items: ReadonlyArray<Value> };
  Map: { readonly fields: ConfigRecord };
  Opaque: {};
}>;

type ConfigRecord = Readonly<Record<string, Value>>;

const Value = Data.taggedEnum<Value>();

const fromJson = (json: unknown): Value =>
  Match.value(json).pipe(
    Match.when(Match.string, (text) => Value.Text({ text })),
    Match.when(Array.isArray, (items) => Value.List({ items: Array.map(items, fromJson) })),
    Match.when(Predicate.isObject, (record) => Value.Map({ fields: Record.map(record, fromJson) })),
    Match.orElse(() => Value.Opaque()),
  );

// An alias repeats what its anchor holds, which is read where the anchor stands.
const fromYaml = (node: unknown): Value =>
  Match.value(node).pipe(
    Match.when(YAML.isScalar, (scalar) => fromJson(scalar.value)),
    Match.when(YAML.isSeq, (seq) => Value.List({ items: Array.map(seq.items, fromYaml) })),
    Match.when(YAML.isMap, (map) =>
      Value.Map({
        fields: Record.fromEntries(
          Array.flatMap(map.items, (pair) =>
            Match.value(pair.key).pipe(
              Match.when(YAML.isScalar, (key) => [[`${key.value}`, fromYaml(pair.value)] as const]),
              Match.orElse(() => []),
            ),
          ),
        ),
      }),
    ),
    Match.orElse(() => Value.Opaque()),
  );

// whole: the config when it is a single string, such as a shared Prettier config's name.
type Collected = {
  readonly records: ReadonlyArray<ConfigRecord>;
  readonly strings: ReadonlyArray<string>;
  readonly whole: Option.Option<string>;
};

const recordsWithin: (value: Value) => ReadonlyArray<ConfigRecord> = Value.$match({
  Text: () => [],
  List: ({ items }) => Array.flatMap(items, recordsWithin),
  Map: ({ fields }) => [fields, ...Array.flatMap(Record.values(fields), recordsWithin)],
  Opaque: () => [],
});

const stringsWithin: (value: Value) => ReadonlyArray<string> = Value.$match({
  Text: ({ text }) => [text],
  List: ({ items }) => Array.flatMap(items, stringsWithin),
  Map: ({ fields }) => Array.flatMap(Record.values(fields), stringsWithin),
  Opaque: () => [],
});

const textOf: (value: Value) => ReadonlyArray<string> = Value.$match({
  Text: ({ text }) => [text],
  List: () => [],
  Map: () => [],
  Opaque: () => [],
});

const fromValue = (root: Value): Collected => ({
  records: recordsWithin(root),
  strings: stringsWithin(root),
  whole: Array.head(textOf(root)),
});

const staticRecord = (object: ObjectExpression): ConfigRecord =>
  Record.fromEntries(Array.getSomes(Array.map(object.properties, staticProperty)));

// Each value a condition can take; a && b and a ?? b take b when they take a string.
const alternatives = (node: ArrayExpressionElement): ReadonlyArray<ArrayExpressionElement> =>
  Match.value(node).pipe(
    Match.when({ type: 'ConditionalExpression' }, (condition) => [
      ...alternatives(condition.consequent),
      ...alternatives(condition.alternate),
    ]),
    Match.when({ type: 'LogicalExpression' }, (logical) => alternatives(logical.right)),
    Match.orElse((value) => [value]),
  );

// The value an expression spells out literally; anything computed is opaque. A call with one
// argument, such as Storybook's getAbsolutePath('<package>'), stands for that argument.
const staticValue = (node: ArrayExpressionElement): Value =>
  Match.value(node).pipe(
    Match.when(Match.null, () => Value.Opaque()),
    Match.when({ type: 'Literal' }, (literal) => fromJson(literal.value)),
    Match.when({ type: 'TemplateLiteral' }, (template) =>
      pipe(
        Option.liftPredicate(template, (quoted) => Array.isReadonlyArrayEmpty(quoted.expressions)),
        Option.flatMap((quoted) => Array.head(quoted.quasis)),
        Option.flatMap((quasi) => Option.fromNullOr(quasi.value.cooked)),
        Option.match({ onNone: () => Value.Opaque(), onSome: (text) => Value.Text({ text }) }),
      ),
    ),
    Match.when({ type: 'ArrayExpression' }, (list) =>
      Value.List({ items: Array.map(Array.flatMap(list.elements, alternatives), staticValue) }),
    ),
    Match.whenOr({ type: 'ConditionalExpression' }, { type: 'LogicalExpression' }, (condition) =>
      Value.List({ items: Array.map(alternatives(condition), staticValue) }),
    ),
    Match.when({ type: 'CallExpression' }, (call) =>
      pipe(
        Option.liftPredicate(call.arguments, (args) => args.length === 1),
        Option.flatMap(Array.head),
        Option.match({ onNone: () => Value.Opaque(), onSome: staticValue }),
      ),
    ),
    Match.when({ type: 'ObjectExpression' }, (object) =>
      Value.Map({ fields: staticRecord(object) }),
    ),
    Match.whenOr(
      { type: 'TSAsExpression' },
      { type: 'TSSatisfiesExpression' },
      { type: 'ParenthesizedExpression' },
      (wrapped) => staticValue(wrapped.expression),
    ),
    Match.orElse(() => Value.Opaque()),
  );

const staticProperty = (property: ObjectPropertyKind): Option.Option<readonly [string, Value]> =>
  Match.value(property).pipe(
    Match.when({ type: 'Property', computed: false, key: { type: 'Identifier' } }, (named) =>
      Option.some([named.key.name, staticValue(named.value)] as const),
    ),
    Match.when({ type: 'Property', key: { type: 'Literal', value: Match.string } }, (quoted) =>
      Option.some([quoted.key.value, staticValue(quoted.value)] as const),
    ),
    Match.orElse(() => Option.none()),
  );

// Every object literal is read on its own, so an override or a nested option block counts too.
const fromProgram = (program: Program): Collected => ({
  records: collectVisiting<ConfigRecord>(program, (collect) => ({
    ObjectExpression: (node) => collect([staticRecord(node)]),
  })),
  strings: collectVisiting<string>(program, (collect) => ({
    Literal: (node) => collect(Array.filter([node.value], Predicate.isString)),
  })),
  whole: Option.none(),
});

type Reader = (value: Value) => ReadonlyArray<PackageName>;

type Convention = (name: string) => ReadonlyArray<PackageName>;

const entryName: (entry: Value) => ReadonlyArray<string> = Value.$match({
  Text: ({ text }) => [text],
  List: ({ items }) => Array.flatMap(Array.take(items, 1), textOf),
  Map: ({ fields }) =>
    Option.match(Record.get(fields, 'name'), { onNone: () => [], onSome: textOf }),
  Opaque: () => [],
});

// A name, a list of names, [name, options] pairs or { name } objects.
const entries = (value: Value): ReadonlyArray<string> =>
  Value.$match(value, {
    Text: () => entryName(value),
    List: ({ items }) => Array.flatMap(items, entryName),
    Map: () => entryName(value),
    Opaque: () => [],
  });

const keysOf: (value: Value) => ReadonlyArray<string> = Value.$match({
  Text: () => [],
  List: () => [],
  Map: ({ fields }) => Record.keys(fields),
  Opaque: () => [],
});

const valuesOf: (value: Value) => ReadonlyArray<string> = Value.$match({
  Text: () => [],
  List: () => [],
  Map: ({ fields }) => Array.flatMap(Record.values(fields), entryName),
  Opaque: () => [],
});

const entriesAndKeys = (value: Value): ReadonlyArray<string> => [
  ...entries(value),
  ...keysOf(value),
];

const exact = (name: string): ReadonlyArray<PackageName> =>
  Option.toArray(extractPackageName(name));

const isScope = (name: string): boolean => /^@[^/]+$/.test(name);

const withPrefix =
  (prefix: string) =>
  (name: string): string =>
    name === prefix || String.startsWith(`${prefix}-`)(name) ? name : `${prefix}-${name}`;

const expandPackage =
  (prefix: string) =>
  (name: PackageName): PackageName =>
    Match.value(name).pipe(
      Match.when(String.startsWith('@'), (scoped) =>
        pipe(scoped.indexOf('/'), (slash) =>
          [scoped.slice(0, slash), withPrefix(prefix)(scoped.slice(slash + 1))].join('/'),
        ),
      ),
      Match.orElse(withPrefix(prefix)),
    );

// ESLint's naming convention, also used by Babel and Jest: x → <prefix>-x, @s → @s/<prefix>,
// @s/x → @s/<prefix>-x.
const expand =
  (prefix: string) =>
  (name: string): ReadonlyArray<PackageName> =>
    Match.value(name).pipe(
      Match.when(isScope, (scope) => [`${scope}/${prefix}`]),
      Match.orElse((named) => Array.map(exact(named), expandPackage(prefix))),
    );

const eslintPlugin = expand('eslint-plugin');

const beforeLastSlash = (name: string): string => name.slice(0, Math.max(name.lastIndexOf('/'), 0));

const eslintConfig = (name: string): ReadonlyArray<PackageName> =>
  Match.value(name).pipe(
    Match.when(String.startsWith('eslint:'), () => []),
    Match.when(String.startsWith('plugin:'), (config) =>
      eslintPlugin(beforeLastSlash(config.slice(7))),
    ),
    Match.orElse(expand('eslint-config')),
  );

const ruleOwner = (rule: string): ReadonlyArray<PackageName> =>
  Match.value(rule).pipe(
    Match.when(String.includes('/'), (scoped) => eslintPlugin(beforeLastSlash(scoped))),
    Match.orElse(() => []),
  );

const babelName =
  (kind: 'plugin' | 'preset') =>
  (name: string): ReadonlyArray<PackageName> =>
    Match.value(name).pipe(
      Match.when(String.startsWith('module:'), (module) => exact(module.slice(7))),
      Match.when(String.startsWith('@babel/'), (official) =>
        Array.map(exact(official), (pkg) => `@babel/${withPrefix(kind)(pkg.slice(7))}`),
      ),
      Match.orElse(expand(`babel-${kind}`)),
    );

// commitlint takes a scoped name with a slash as it is.
const commitlintConfig = (name: string): ReadonlyArray<PackageName> =>
  Match.value(name).pipe(
    Match.when(isScope, (scope) => [`${scope}/commitlint-config`]),
    Match.when(String.startsWith('@'), exact),
    Match.orElse(expand('commitlint-config')),
  );

// An Nx executor is <package>:<name>.
const executorPackage = (executor: string): ReadonlyArray<PackageName> =>
  exact(Array.headNonEmpty(String.split(executor, ':')));

const reading =
  (read: (value: Value) => ReadonlyArray<string>, convention: Convention): Reader =>
  (value: Value): ReadonlyArray<PackageName> =>
    Array.flatMap(read(value), convention);

const KEYS: Readonly<Record<KnownTool, Readonly<Record<string, Reader>>>> = {
  eslint: {
    parser: reading(entries, exact),
    plugins: reading(entries, eslintPlugin),
    extends: reading(entries, eslintConfig),
    rules: reading(keysOf, ruleOwner),
    'import/resolver': reading(entriesAndKeys, expand('eslint-import-resolver')),
  },
  babel: {
    presets: reading(entries, babelName('preset')),
    plugins: reading(entries, babelName('plugin')),
  },
  postcss: { plugins: reading(entriesAndKeys, exact) },
  jest: {
    preset: reading(entries, exact),
    testEnvironment: reading(entries, expand('jest-environment')),
    transform: reading(valuesOf, exact),
    setupFiles: reading(entries, exact),
    setupFilesAfterEnv: reading(entries, exact),
    snapshotSerializers: reading(entries, exact),
    reporters: reading(entries, exact),
  },
  prettier: { plugins: reading(entries, exact) },
  stylelint: { extends: reading(entries, exact), plugins: reading(entries, exact) },
  commitlint: { extends: reading(entries, commitlintConfig), plugins: reading(entries, exact) },
  storybook: {
    addons: reading(entries, exact),
    framework: reading(entries, exact),
    builder: reading(entries, exact),
  },
  serverless: { plugins: reading(entries, exact), modules: reading(entries, exact) },
  nx: { executor: reading(entries, executorPackage) },
};

const keyedNames =
  (tool: KnownTool) =>
  (records: ReadonlyArray<ConfigRecord>): ReadonlyArray<PackageName> =>
    Array.flatMap(records, (record) =>
      Array.flatMap(Record.toEntries(record), ([key, value]) =>
        Option.match(Record.get(KEYS[tool], key), {
          onNone: () => [],
          onSome: (read) => read(value),
        }),
      ),
    );

const isPackageName = (text: string): boolean =>
  Option.exists(extractPackageName(text), (name) => name === text);

const commandsOf: (value: Value) => ReadonlyArray<string> = Value.$match({
  Text: ({ text }) => [text],
  List: ({ items }) => Array.flatMap(items, textOf),
  Map: () => [],
  Opaque: () => [],
});

type Uses = {
  readonly names: ReadonlyArray<PackageName>;
  readonly commands: ReadonlyArray<string>;
};

const usesOf =
  (tool: Tool) =>
  (collected: Collected): Uses =>
    Match.value(tool).pipe(
      Match.when('other', () => ({
        names: Array.filter(collected.strings, isPackageName),
        commands: [],
      })),
      Match.when('lint-staged', () => ({
        names: [],
        commands: Array.flatMap(collected.records, (record) =>
          Array.flatMap(Record.values(record), commandsOf),
        ),
      })),
      Match.when('prettier', (prettier) => ({
        names: [
          ...Array.flatMap(Option.toArray(collected.whole), exact),
          ...keyedNames(prettier)(collected.records),
        ],
        commands: [],
      })),
      Match.whenOr(
        'eslint',
        'babel',
        'postcss',
        'jest',
        'stylelint',
        'commitlint',
        'storybook',
        'serverless',
        'nx',
        (known) => ({ names: keyedNames(known)(collected.records), commands: [] }),
      ),
      Match.exhaustive,
    );

type Found = {
  readonly references: ReadonlyArray<ImportDetails>;
  readonly commands: ReadonlyArray<ScriptCommand>;
};

const foundIn = (file: string, tool: Tool, collected: Collected): Found => {
  const uses = usesOf(tool)(collected);
  return {
    references: Array.map(Array.dedupe(uses.names), (name) => developmentUse(name, file, name)),
    commands: Array.map(uses.commands, (script) => ({ file, script, scripts: [] })),
  };
};

type ConfigFile = { readonly path: string; readonly tool: Tool };

const toolOf = (relativePath: string): Option.Option<Tool> =>
  Array.findFirst(CONFIG_FILES, ([pattern, tool]) =>
    Option.map(
      Option.liftPredicate(relativePath, (file) => pattern.test(file)),
      () => tool,
    ),
  );

const configFilesIn = (layoutRoot: string): Gathered<ConfigFile> =>
  gatherAll(
    Array.map(['', '.storybook'], (dir) =>
      gatherOptional(
        Result.map(readDirectory(path.join(layoutRoot, dir)), (dirents) =>
          pipe(
            dirents,
            Array.filter((dirent) => !dirent.isDirectory()),
            Array.map((dirent) => path.posix.join(dir, dirent.name)),
            Array.map((relative) =>
              Option.map(toolOf(relative), (tool) => ({
                path: path.join(layoutRoot, relative),
                tool,
              })),
            ),
            Array.getSomes,
          ),
        ),
      ),
    ),
  );

// rc: a file without an extension, such as .eslintrc, which its tools read as JSON with comments
// or as YAML. Every other extension CONFIG_FILES admits is JS or TS.
type Format = 'script' | 'json' | 'yaml' | 'rc';

const formatOf = (file: string): Format =>
  Match.value(path.extname(file)).pipe(
    Match.when('', (): Format => 'rc'),
    Match.whenOr('.json', '.jsonc', (): Format => 'json'),
    Match.whenOr('.yaml', '.yml', (): Format => 'yaml'),
    Match.orElse((): Format => 'script'),
  );

const collectFrom =
  (file: string) =>
  (text: string): Result.Result<Collected, FileError> => {
    const json = () => Result.map(decodeJsonc(Schema.Unknown)(file)(text), fromJson);
    const yaml = () =>
      Result.map(decodeYamlDocument(file)(text), (document) => fromYaml(document.contents));
    return Match.value(formatOf(file)).pipe(
      Match.when('script', () => Result.succeed(fromProgram(parse(text, file).program))),
      Match.when('json', () => Result.map(json(), fromValue)),
      Match.when('yaml', () => Result.map(yaml(), fromValue)),
      Match.when('rc', () => Result.map(Result.orElse(json(), yaml), fromValue)),
      Match.exhaustive,
    );
  };

const collect = (file: string): Result.Result<Collected, FileError> =>
  Result.flatMap(readFile(file), collectFrom(file));

export const readToolConfigs = (
  layoutRoots: ReadonlyArray<string>,
  manifests: ReadonlyArray<LayoutManifest>,
): Found & { readonly skipped: ReadonlyArray<FileError> } => {
  const files = gatherAll(Array.map(layoutRoots, configFilesIn));
  const read = gatherAll(
    Array.map(files.found, (file) =>
      gatherOptional(
        Result.map(collect(file.path), (collected) => [foundIn(file.path, file.tool, collected)]),
      ),
    ),
  );
  const sections = Array.flatMap(manifests, (manifest) =>
    Array.map(manifest.tools, ([key, value]) =>
      foundIn(manifest.path, PACKAGE_JSON_TOOLS[key], fromValue(fromJson(value))),
    ),
  );
  const all = [...read.found, ...sections];
  return {
    references: Array.flatMap(all, (found) => found.references),
    commands: Array.flatMap(all, (found) => found.commands),
    skipped: [...files.skipped, ...read.skipped],
  };
};
