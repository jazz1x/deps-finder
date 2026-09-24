import path from 'node:path';
import type {
  Argument,
  BindingPattern,
  BindingProperty,
  BindingRestElement,
  CallExpression,
  Expression,
  IdentifierReference,
  ParamPattern,
  Program,
  TSGlobalDeclaration,
  TSImportEqualsDeclaration,
  TSModuleDeclaration,
} from '@oxc-project/types';
import { Array, Data, Match, Option, Order, Record, Result, String, pipe } from 'effect';
import {
  type Comment,
  type DynamicImport,
  type ParseResult,
  type ParserOptions,
  type StaticExport,
  type StaticImport,
  Visitor,
  type VisitorObject,
  parseSync,
} from 'oxc-parser';
import {
  ALWAYS_EXCLUDED,
  ANALYZABLE_EXTENSIONS,
  BUILD_OUTPUT_DIRECTORIES,
  COMPONENT_EXTENSIONS,
  DECLARATION_FILE_PATTERN,
  DEVELOPMENT_DIRECTORIES,
  DEVELOPMENT_FILENAME_PATTERNS,
  EXCLUDED_WITHOUT_GITIGNORE,
  ROOT_TOOLING_DIRECTORIES,
  ROOT_TOOL_CONFIG_PATTERN,
  STYLESHEET_EXTENSIONS,
  TSCONFIG_FILE_PATTERN,
  TYPESCRIPT_EXTENSIONS,
} from '../constants/patterns.js';
import type { FileError } from '../domain/errors.js';
import {
  type DependencyType,
  type FileContext,
  type Gathered,
  type ImportDetails,
  type ImportElision,
  type ImportType,
  JsxRuntime,
  type PackageJson,
  type PackageName,
  type SourceFile,
} from '../domain/types.js';
import { componentScripts, componentStyles } from './component-blocks.js';
import { UNCONFIGURED, emitSettingsOf } from './emit-settings.js';
import { type StyleSyntax, stylesheetReferences } from './stylesheet-parser.js';
import { type LayoutManifest, readLayoutManifest, readPackageJson } from './package-parser.js';
import { detectBuildDirectories, detectByHeuristic } from '../utils/detect-build-dirs.js';
import { gatherAll, gatherOptional, readFile } from '../utils/file-reader.js';
import { buildLineStarts, lineNumberAt } from '../utils/line-index.js';
import { type LeftOut, walkProject } from '../utils/project-walk.js';
import {
  type TsConfigChain,
  readRootTsConfigs,
  readTsConfigChains,
} from '../utils/tsconfig-reader.js';

const PACKAGE_NAME = /^(?![./]|https?:|file:)(@[^/]+\/[^/]+|[^@/][^/]*)/;

export const extractPackageName = (specifier: string): Option.Option<string> =>
  Option.fromNullishOr(PACKAGE_NAME.exec(specifier)?.[1]);

const hasAnalyzableExtension = (filePath: string): boolean =>
  Array.contains(ANALYZABLE_EXTENSIONS, path.extname(filePath));

const isTsConfig = (filePath: string): boolean =>
  TSCONFIG_FILE_PATTERN.test(path.basename(filePath));

export const shouldAnalyzeFile = (filePath: string): boolean =>
  hasAnalyzableExtension(filePath) || isTsConfig(filePath);

type SourceKind =
  | 'tsconfig'
  | 'declaration'
  | 'typescript'
  | 'javascript'
  | 'component'
  | 'stylesheet';

const sourceKindOf = (filePath: string): SourceKind =>
  Match.value(filePath).pipe(
    Match.when(isTsConfig, (): SourceKind => 'tsconfig'),
    Match.when(
      (file) => Array.contains(COMPONENT_EXTENSIONS, path.extname(file)),
      (): SourceKind => 'component',
    ),
    Match.when(
      (file) => Array.contains(STYLESHEET_EXTENSIONS, path.extname(file)),
      (): SourceKind => 'stylesheet',
    ),
    Match.when(
      (file) => DECLARATION_FILE_PATTERN.test(file),
      (): SourceKind => 'declaration',
    ),
    Match.when(
      (file) => Array.contains(TYPESCRIPT_EXTENSIONS, path.extname(file)),
      (): SourceKind => 'typescript',
    ),
    Match.orElse((): SourceKind => 'javascript'),
  );

type PathSegments = Array.NonEmptyReadonlyArray<string>;

type Placement = {
  readonly segments: PathSegments;
  readonly fromLayoutRoots: ReadonlyArray<PathSegments>;
};

const segmentsOf = (relativePath: string): PathSegments => String.split(relativePath, /[\\/]/);

const isHidden = String.startsWith('.');

const isRootToolDirectory = (name: string): boolean =>
  isHidden(name) || Array.contains(ROOT_TOOLING_DIRECTORIES, name);

const isDevelopmentPath: ReadonlyArray<(placement: Placement) => boolean> = [
  ({ segments }) =>
    Array.some(Array.initNonEmpty(segments), (dir) => Array.contains(DEVELOPMENT_DIRECTORIES, dir)),
  ({ segments }) =>
    Array.some(DEVELOPMENT_FILENAME_PATTERNS, (pattern) =>
      Array.lastNonEmpty(segments).includes(pattern),
    ),
  ({ segments }) => isHidden(Array.lastNonEmpty(segments)),
  ({ fromLayoutRoots }) =>
    Array.some(fromLayoutRoots, (fromLayoutRoot) =>
      Array.match(Array.tailNonEmpty(fromLayoutRoot), {
        onEmpty: () => ROOT_TOOL_CONFIG_PATTERN.test(Array.headNonEmpty(fromLayoutRoot)),
        onNonEmpty: () => isRootToolDirectory(Array.headNonEmpty(fromLayoutRoot)),
      }),
    ),
];

// A package.json "bin" target ships to users wherever it sits.
export const fileContextOf =
  (shipped: ReadonlyArray<string>) =>
  (source: { readonly path: string; readonly layoutRoots: ReadonlyArray<string> }): FileContext => {
    const placement: Placement = {
      segments: segmentsOf(source.path),
      fromLayoutRoots: Array.map(source.layoutRoots, (root) =>
        segmentsOf(path.posix.relative(root, source.path)),
      ),
    };
    return !Array.contains(shipped, source.path) &&
      Array.some(isDevelopmentPath, (matches) => matches(placement))
      ? 'development'
      : 'production';
  };

type ModuleReference = {
  readonly specifier: string;
  readonly importType: ImportType;
  readonly start: number;
  readonly end: number;
};

type Span = { readonly start: number; readonly end: number };

const referenceAt = (specifier: string, isTypeOnly: boolean, span: Span): ModuleReference => ({
  specifier,
  importType: isTypeOnly ? 'type-only' : 'runtime',
  start: span.start,
  end: span.end,
});

const DECLARED_TYPE_ONLY = /^(?:import|export)\s+type\s*(?:[{*]|[\w$]+\s+from\b)/;

// Under verbatim, `import { type A } from "x"` still emits `import {} from "x"`.
const erasesAllTypeSpecifiers =
  (content: string, elision: ImportElision) =>
  (statement: Span): boolean =>
    Match.value(elision).pipe(
      Match.whenOr('unused-bindings', 'decorator-metadata', () => true),
      Match.when('verbatim', () =>
        DECLARED_TYPE_ONLY.test(content.slice(statement.start, statement.end)),
      ),
      Match.exhaustive,
    );

const staticImportReference =
  (erased: (statement: Span) => boolean) =>
  (statement: StaticImport): ModuleReference =>
    referenceAt(
      statement.moduleRequest.value,
      Array.isReadonlyArrayNonEmpty(statement.entries) &&
        Array.every(statement.entries, (entry) => entry.isType) &&
        erased(statement),
      statement,
    );

const reExportReference =
  (erased: (statement: Span) => boolean) =>
  (statement: StaticExport): Option.Option<ModuleReference> =>
    pipe(
      statement.entries,
      Array.map((entry) => Option.fromNullishOr(entry.moduleRequest)),
      Array.getSomes,
      Array.head,
      Option.map((request) =>
        referenceAt(
          request.value,
          Array.every(statement.entries, (entry) => entry.isType) && erased(statement),
          statement,
        ),
      ),
    );

const QUOTED = /^(['"])(.*)\1$/s;

const dynamicImportReference =
  (content: string) =>
  (expression: DynamicImport): Option.Option<ModuleReference> =>
    pipe(
      QUOTED.exec(content.slice(expression.moduleRequest.start, expression.moduleRequest.end)),
      (quoted) => Option.fromNullishOr(quoted?.[2]),
      Option.map((specifier) => referenceAt(specifier, false, expression)),
    );

const stringLiteralValue = (argument: Argument | undefined): Option.Option<string> =>
  Match.value(argument).pipe(
    Match.when({ type: 'Literal', value: Match.string }, (literal) => Option.some(literal.value)),
    Match.orElse(() => Option.none()),
  );

const isRequireCall = (call: CallExpression): boolean =>
  call.callee.type === 'Identifier' &&
  call.callee.name === 'require' &&
  call.arguments.length === 1;

const requireReference = (call: CallExpression): ReadonlyArray<ModuleReference> =>
  pipe(
    Option.liftPredicate(call, isRequireCall),
    Option.flatMap((required) => stringLiteralValue(required.arguments[0])),
    Option.map((specifier) => referenceAt(specifier, false, call)),
    Option.toArray,
  );

const importEqualsReference = (decl: TSImportEqualsDeclaration): ReadonlyArray<ModuleReference> =>
  Match.value(decl.moduleReference).pipe(
    Match.when({ type: 'TSExternalModuleReference' }, (external) => [
      referenceAt(external.expression.value, decl.importKind === 'type', decl),
    ]),
    Match.orElse(() => []),
  );

const augmentationReference = (
  node: TSModuleDeclaration | TSGlobalDeclaration,
): ReadonlyArray<ModuleReference> =>
  Match.value(node).pipe(
    Match.when({ type: 'TSModuleDeclaration', id: { type: 'Literal' } }, (declaration) => [
      referenceAt(declaration.id.value, true, {
        start: declaration.start,
        end: declaration.id.end,
      }),
    ]),
    Match.orElse(() => []),
  );

// `declare module "x"` augments x only inside a module; in a script it declares an ambient module.
type AstReferences = {
  readonly references: ReadonlyArray<ModuleReference>;
  readonly augmentations: ReadonlyArray<ModuleReference>;
};

const NO_AST_REFERENCES: AstReferences = { references: [], augmentations: [] };

// The one place that collects by mutation: oxc's Visitor walks 15.7k lines in 31ms where a pure
// recursive fold took 139ms.
export const collectVisiting = <A>(
  program: Program,
  visitor: (collect: (found: ReadonlyArray<A>) => void) => VisitorObject,
): ReadonlyArray<A> => {
  const found: A[] = [];
  new Visitor(visitor((items) => found.push(...items))).visit(program);
  return found;
};

type AstReference = Data.TaggedEnum<{
  Reference: { readonly reference: ModuleReference };
  Augmentation: { readonly reference: ModuleReference };
}>;

const AstReference = Data.taggedEnum<AstReference>();

const references = (found: ReadonlyArray<ModuleReference>): ReadonlyArray<AstReference> =>
  Array.map(found, (reference) => AstReference.Reference({ reference }));

// ESM comes from oxc's module record without materialising the AST. The other forms need the AST.
const astReferences = (program: Program): AstReferences => {
  const [found, augmentations] = Array.partition(
    collectVisiting<AstReference>(program, (collect) => ({
      CallExpression: (node) => collect(references(requireReference(node))),
      TSImportEqualsDeclaration: (node) => collect(references(importEqualsReference(node))),
      TSImportType: (node) => collect(references([referenceAt(node.source.value, true, node)])),
      TSModuleDeclaration: (node) =>
        collect(
          Array.map(augmentationReference(node), (reference) =>
            AstReference.Augmentation({ reference }),
          ),
        ),
    })),
    AstReference.$match({
      Reference: ({ reference }) => Result.fail(reference),
      Augmentation: ({ reference }) => Result.succeed(reference),
    }),
  );
  return { references: found, augmentations };
};

const AST_MARKER = /require|declare\s+module/;

const IMPORT_CALL = /\bimport(?:\s|\/\*[\s\S]*?\*\/)*\(/g;

const importCalls = (text: string): number => [...text.matchAll(IMPORT_CALL)].length;

// The module record already holds every import() expression and the comments are read anyway;
// building the program only for those cost foodspring-front 20-30ms and a JSDoc-heavy tree 2.4x.
const hasTypeImport = (content: string, parsed: ParseResult): boolean => {
  const surplus = importCalls(content) - parsed.module.dynamicImports.length;
  return (
    surplus > 0 &&
    surplus > Array.reduce(parsed.comments, 0, (sum, comment) => sum + importCalls(comment.value))
  );
};

const TYPE_REFERENCE = /^\/\s*<reference\b[^>]*?\btypes\s*=\s*(['"])([^'"]+)\1/;

const JSDOC_TYPE_IMPORT = /import\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

const JSDOC_IMPORT_TAG = /@import\s[^@]*?\bfrom\s*(['"])([^'"]+)\1/g;

const isInsideBraces = (before: string): boolean =>
  before.split('{').length > before.split('}').length;

// TypeScript reads import("x") in JSDoc only inside a {type}; elsewhere it is prose.
const jsdocImports = (jsdoc: string): ReadonlyArray<RegExpExecArray> => [
  ...Array.filter([...jsdoc.matchAll(JSDOC_TYPE_IMPORT)], (match) =>
    isInsideBraces(jsdoc.slice(0, match.index)),
  ),
  ...jsdoc.matchAll(JSDOC_IMPORT_TAG),
];

const COMMENT_MARKER = /<reference|@import|import\s*\(/;

// A comment's value starts after its `//` or `/*`.
const commentMatchReference =
  (comment: Comment) =>
  (match: RegExpExecArray): Option.Option<ModuleReference> =>
    Option.map(Option.fromNullishOr(match[2]), (specifier) =>
      referenceAt(specifier, true, {
        start: comment.start + 2 + match.index,
        end: comment.start + 2 + match.index + match[0].length,
      }),
    );

const commentReferences = (comment: Comment): ReadonlyArray<ModuleReference> =>
  Match.value(comment).pipe(
    Match.when({ type: 'Line' }, (line) =>
      pipe(
        Option.fromNullishOr(TYPE_REFERENCE.exec(line.value)),
        Option.flatMap(commentMatchReference(line)),
        Option.toArray,
      ),
    ),
    Match.when({ type: 'Block', value: String.startsWith('*') }, (jsdoc) =>
      Array.getSomes(Array.map(jsdocImports(jsdoc.value), commentMatchReference(jsdoc))),
    ),
    Match.orElse((): ReadonlyArray<ModuleReference> => []),
  );

// CRA and older Vite projects write JSX in .js files.
const JSX_LANG: ParserOptions = { lang: 'jsx' };

const OPTIONS_BY_EXTENSION: Readonly<Record<string, ParserOptions>> = {
  '.js': JSX_LANG,
  '.mjs': JSX_LANG,
  '.cjs': JSX_LANG,
};

export const parse = (content: string, filePath: string): ParseResult =>
  parseSync(
    filePath,
    content,
    Option.getOrUndefined(Record.get(OPTIONS_BY_EXTENSION, path.extname(filePath))),
  );

const WITHOUT_JSX: Readonly<Record<string, ParserOptions>> = {
  '.tsx': { lang: 'ts' },
  '.jsx': { lang: 'js' },
  '.js': { lang: 'js' },
  '.mjs': { lang: 'js' },
  '.cjs': { lang: 'js' },
};

// A file that parses only with JSX holds JSX. Walking every such AST for JSX nodes cost
// foodspring-front 1.3s over a 0.2s parse; this second parse costs 30ms and fails on the same files.
const firstJsxAt = (
  content: string,
  filePath: string,
  parsed: ParseResult,
): Option.Option<number> =>
  pipe(
    Record.get(WITHOUT_JSX, path.extname(filePath)),
    Option.filter(() => content.includes('<') && Array.isReadonlyArrayEmpty(parsed.errors)),
    Option.flatMap((options) => Array.head(parseSync(filePath, content, options).errors)),
    // An error without a label still means JSX, which starts at the first '<' or after it.
    Option.map((error) =>
      pipe(
        Array.head(error.labels),
        Option.map((label) => label.start),
        Option.getOrElse(() => content.indexOf('<')),
      ),
    ),
  );

const lineAround = (content: string, at: number): Span => ({
  start: content.lastIndexOf('\n', at - 1) + 1,
  end: pipe(content.indexOf('\n', at), (end) => (end === -1 ? content.length : end)),
});

const pragmaIn =
  (content: string, parsed: ParseResult) =>
  (pragma: RegExp): Option.Option<string> =>
    pipe(
      Option.liftPredicate(content, String.includes('@jsx')),
      Option.flatMap(() =>
        Array.findFirst(parsed.comments, (comment) =>
          Option.fromNullishOr(pragma.exec(comment.value)?.[1]),
        ),
      ),
    );

const toClassic = JsxRuntime.$match({
  Classic: (classic) => classic,
  Automatic: () => JsxRuntime.Classic({ factory: 'React' }),
  Preserved: ({ factory }) => JsxRuntime.Classic({ factory }),
});

const toAutomatic = JsxRuntime.$match({
  Classic: () => JsxRuntime.Automatic({ importSource: 'react' }),
  Automatic: (automatic) => automatic,
  Preserved: () => JsxRuntime.Automatic({ importSource: 'react' }),
});

const RUNTIME_PRAGMAS: Readonly<Record<string, (runtime: JsxRuntime) => JsxRuntime>> = {
  classic: toClassic,
  automatic: toAutomatic,
};

// A file's @jsxRuntime, @jsx and @jsxImportSource pragmas override its tsconfig, as in tsc and Babel.
export const fileJsxRuntimes = (
  content: string,
  parsed: ParseResult,
  configured: Array.NonEmptyReadonlyArray<JsxRuntime>,
): Array.NonEmptyReadonlyArray<JsxRuntime> => {
  const pragma = pragmaIn(content, parsed);
  const switchTo = pipe(
    pragma(/@jsxRuntime\s+(\S+)/),
    Option.flatMap((mode) => Record.get(RUNTIME_PRAGMAS, mode)),
    Option.getOrElse(() => (runtime: JsxRuntime) => runtime),
  );
  const factory = pragma(/@jsx\s+([\w$]+)/);
  const importSource = pragma(/@jsxImportSource\s+(\S+)/);
  return Array.dedupe(
    Array.map(configured, (runtime): JsxRuntime =>
      JsxRuntime.$match(switchTo(runtime), {
        Classic: (classic) =>
          JsxRuntime.Classic({ factory: Option.getOrElse(factory, () => classic.factory) }),
        Automatic: (automatic) =>
          JsxRuntime.Automatic({
            importSource: Option.getOrElse(importSource, () => automatic.importSource),
          }),
        Preserved: (preserved) =>
          Option.match(importSource, {
            onNone: () =>
              JsxRuntime.Preserved({ factory: Option.getOrElse(factory, () => preserved.factory) }),
            onSome: (source) => JsxRuntime.Automatic({ importSource: source }),
          }),
      }),
    ),
  );
};

const jsxRuntimeReferences = (
  content: string,
  filePath: string,
  parsed: ParseResult,
  configured: Array.NonEmptyReadonlyArray<JsxRuntime>,
): ReadonlyArray<ModuleReference> =>
  Option.match(firstJsxAt(content, filePath, parsed), {
    onNone: () => [],
    onSome: (at) =>
      Array.flatMap(
        fileJsxRuntimes(content, parsed, configured),
        JsxRuntime.$match({
          Classic: (): ReadonlyArray<ModuleReference> => [],
          Automatic: ({ importSource }) => [
            referenceAt(importSource, false, lineAround(content, at)),
          ],
          Preserved: () => [referenceAt('react', false, lineAround(content, at))],
        }),
      ),
  });

const TEST_GLOBALS = ['describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach'];

const TEST_GLOBAL_CALL =
  /(?<![\w$.])(describe|it|test|expect|beforeEach|afterEach)\s*(?:\.\s*[\w$]+\s*)*[(`]/g;

const TEST_GLOBAL_TYPES = ['@types/jest', '@types/mocha', '@types/jasmine'] as const;

type Binder = BindingPattern | BindingProperty | BindingRestElement | ParamPattern | null;

const boundNames = (binder: Binder): ReadonlyArray<string> =>
  Match.value(binder).pipe(
    Match.when({ type: 'Identifier' }, (identifier) => [identifier.name]),
    Match.when({ type: 'ObjectPattern' }, (object) => Array.flatMap(object.properties, boundNames)),
    Match.when({ type: 'Property' }, (property) => boundNames(property.value)),
    Match.when({ type: 'ArrayPattern' }, (array) => Array.flatMap(array.elements, boundNames)),
    Match.when({ type: 'RestElement' }, (rest) => boundNames(rest.argument)),
    Match.when({ type: 'AssignmentPattern' }, (assignment) => boundNames(assignment.left)),
    Match.when({ type: 'TSParameterProperty' }, (property) => boundNames(property.parameter)),
    Match.orElse(() => []),
  );

// describe(), describe.each([...])() and it.each`...`() are all rooted at the global.
const calleeRoot = (callee: Expression): Option.Option<IdentifierReference> =>
  Match.value(callee).pipe(
    Match.when({ type: 'Identifier' }, (identifier) => Option.some(identifier)),
    Match.when({ type: 'MemberExpression' }, (member) => calleeRoot(member.object)),
    Match.when({ type: 'TaggedTemplateExpression' }, (tagged) => calleeRoot(tagged.tag)),
    Match.orElse(() => Option.none()),
  );

// Bound: names a function or catch clause binds inside its own span. Declared: names bound in the
// innermost block around them.
type TestGlobalEvent = Data.TaggedEnum<{
  Call: { readonly callee: IdentifierReference };
  Block: { readonly span: Span };
  Bound: { readonly names: ReadonlyArray<string>; readonly span: Span };
  Declared: { readonly names: ReadonlyArray<string>; readonly at: number };
}>;

const TestGlobalEvent = Data.taggedEnum<TestGlobalEvent>();

type Binding = { readonly names: ReadonlyArray<string>; readonly span: Span };

const within = (span: Span) => (at: number) => span.start <= at && at < span.end;

const block = (span: Span): ReadonlyArray<TestGlobalEvent> => [TestGlobalEvent.Block({ span })];

const declaration = (names: ReadonlyArray<string>, at: number): ReadonlyArray<TestGlobalEvent> => [
  TestGlobalEvent.Declared({ names, at }),
];

const boundIn = (span: Span, binders: ReadonlyArray<Binder>): ReadonlyArray<TestGlobalEvent> => [
  TestGlobalEvent.Bound({ names: Array.flatMap(binders, boundNames), span }),
];

const byLength = Order.mapInput(Order.Number, (span: Span) => span.end - span.start);

// A test runner puts these names in scope; a scope that binds one itself calls its own.
const unboundTestGlobalCall = (
  program: Program,
  imported: ReadonlySet<string>,
): Option.Option<IdentifierReference> => {
  const events = collectVisiting<TestGlobalEvent>(program, (collect) => ({
    CallExpression: (node) =>
      collect(
        pipe(
          calleeRoot(node.callee),
          Option.filter((root) => Array.contains(TEST_GLOBALS, root.name)),
          Option.map((callee) => TestGlobalEvent.Call({ callee })),
          Option.toArray,
        ),
      ),
    BlockStatement: (node) => collect(block(node)),
    StaticBlock: (node) => collect(block(node)),
    ForStatement: (node) => collect(block(node)),
    ForInStatement: (node) => collect(block(node)),
    ForOfStatement: (node) => collect(block(node)),
    SwitchStatement: (node) => collect(block(node)),
    VariableDeclarator: (node) => collect(declaration(boundNames(node.id), node.start)),
    ClassDeclaration: (node) => collect(declaration(boundNames(node.id), node.start)),
    TSImportEqualsDeclaration: (node) => collect(declaration([node.id.name], node.start)),
    FunctionDeclaration: (node) =>
      collect([...declaration(boundNames(node.id), node.start), ...boundIn(node, node.params)]),
    FunctionExpression: (node) => collect(boundIn(node, [node.id, ...node.params])),
    ArrowFunctionExpression: (node) => collect(boundIn(node, node.params)),
    CatchClause: (node) => collect(boundIn(node, [node.param])),
  }));
  const file: Span = { start: program.start, end: program.end };
  const blocks = [
    file,
    ...Array.map(Array.filter(events, TestGlobalEvent.$is('Block')), ({ span }) => span),
  ];
  const innermost = (at: number): Span =>
    Array.reduce(
      Array.filter(blocks, (span) => within(span)(at)),
      file,
      (inner, span) => Order.min(byLength)(inner, span),
    );
  const bindings: ReadonlyArray<Binding> = [
    { names: [...imported], span: file },
    ...Array.filter(events, TestGlobalEvent.$is('Bound')),
    ...Array.map(Array.filter(events, TestGlobalEvent.$is('Declared')), ({ names, at }) => ({
      names,
      span: innermost(at),
    })),
  ];
  return pipe(
    Array.filter(events, TestGlobalEvent.$is('Call')),
    Array.findFirst(
      ({ callee }) =>
        !Array.some(
          bindings,
          ({ names, span }) => Array.contains(names, callee.name) && within(span)(callee.start),
        ),
    ),
    Option.map(({ callee }) => callee),
  );
};

// The text is scanned first: walking every story and test that imports its test functions cost
// foodspring-front 150ms.
const testGlobalReferences = (
  content: string,
  parsed: ParseResult,
): ReadonlyArray<ModuleReference> => {
  const imported = new Set(
    Array.flatMap(parsed.module.staticImports, (statement) =>
      Array.map(statement.entries, (entry) => entry.localName.value),
    ),
  );
  return pipe(
    Option.liftPredicate(parsed, () =>
      Array.some([...content.matchAll(TEST_GLOBAL_CALL)], (call) =>
        Option.exists(Option.fromUndefinedOr(call[1]), (name) => !imported.has(name)),
      ),
    ),
    Option.flatMap((unresolved) => unboundTestGlobalCall(unresolved.program, imported)),
    Option.match({
      onNone: () => [],
      onSome: (callee) => Array.map(TEST_GLOBAL_TYPES, (types) => referenceAt(types, true, callee)),
    }),
  );
};

type Scope = Pick<SourceFile, 'context' | 'emit'>;

const moduleReferences = (
  content: string,
  filePath: string,
  { context, emit }: Scope,
): ReadonlyArray<ModuleReference> => {
  const parsed = parse(content, filePath);
  const ast =
    AST_MARKER.test(content) || hasTypeImport(content, parsed)
      ? astReferences(parsed.program)
      : NO_AST_REFERENCES;
  const erased = erasesAllTypeSpecifiers(content, emit.elision);
  return [
    ...Array.map(parsed.module.staticImports, staticImportReference(erased)),
    ...Array.getSomes(Array.map(parsed.module.staticExports, reExportReference(erased))),
    ...Array.getSomes(Array.map(parsed.module.dynamicImports, dynamicImportReference(content))),
    ...ast.references,
    ...(parsed.module.hasModuleSyntax ? ast.augmentations : []),
    ...(COMMENT_MARKER.test(content) ? Array.flatMap(parsed.comments, commentReferences) : []),
    ...jsxRuntimeReferences(content, filePath, parsed, emit.jsx),
    ...Match.value(context).pipe(
      Match.when('development', () => testGlobalReferences(content, parsed)),
      Match.when('production', () => []),
      Match.exhaustive,
    ),
  ];
};

type FileImport = Omit<ImportDetails, 'context'>;

// parsedAs: the name whose extension picks the parser, a component block's lang for one.
const importsIn = (
  content: string,
  filePath: string,
  parsedAs: string,
  scope: Scope,
): ReadonlyArray<FileImport> => {
  const lineStarts = buildLineStarts(content);

  return pipe(
    moduleReferences(content, parsedAs, scope),
    Array.map((ref) =>
      pipe(
        extractPackageName(ref.specifier),
        Option.map((packageName): FileImport => ({
          packageName,
          importType: ref.importType,
          file: filePath,
          line: lineNumberAt(lineStarts, ref.start),
          importStatement: content.slice(ref.start, ref.end).trim(),
        })),
      ),
    ),
    Array.getSomes,
  );
};

export const extractImports = (
  content: string,
  filePath: string,
  scope: Scope,
): ReadonlyArray<FileImport> => importsIn(content, filePath, filePath, scope);

const styleImports = (
  content: string,
  filePath: string,
  syntax: StyleSyntax,
): Result.Result<ReadonlyArray<FileImport>, FileError> =>
  Result.map(
    stylesheetReferences(filePath, content, syntax),
    Array.flatMap((reference) =>
      Option.toArray(
        Option.map(extractPackageName(reference.specifier), (packageName): FileImport => ({
          packageName,
          importType: 'runtime',
          file: filePath,
          line: reference.line,
          importStatement: reference.statement,
        })),
      ),
    ),
  );

type Extract = (
  content: string,
  source: SourceFile,
) => Result.Result<ReadonlyArray<FileImport>, FileError>;

const readWith =
  (extract: Extract) =>
  (source: SourceFile): Result.Result<ReadonlyArray<ImportDetails>, FileError> =>
    pipe(
      readFile(source.path),
      Result.flatMap((content) => extract(content, source)),
      Result.map(
        Array.map((found): ImportDetails => ({
          ...found,
          context: source.context,
        })),
      ),
    );

const readImports = readWith((content, source) =>
  Result.succeed(extractImports(content, source.path, source)),
);

const STYLE_SYNTAX_BY_EXTENSION: Readonly<Record<string, StyleSyntax>> = {
  '.scss': 'scss',
  '.less': 'less',
};

const readStylesheetImports = readWith((content, source) =>
  styleImports(
    content,
    source.path,
    Option.getOrElse(
      Record.get(STYLE_SYNTAX_BY_EXTENSION, path.extname(source.path)),
      (): StyleSyntax => 'css',
    ),
  ),
);

// A style block that does not parse fails the component, as an unreadable file would.
const readComponentImports = readWith((content, source) =>
  Result.map(
    Result.all(
      Array.map(componentStyles(content), (style) =>
        styleImports(style.text, source.path, style.syntax),
      ),
    ),
    (styles) => [
      ...Array.flatMap(componentScripts(source.path, content), (script) =>
        importsIn(script.text, source.path, `${source.path}${script.parsedAs}`, source),
      ),
      ...Array.flatten(styles),
    ],
  ),
);

const typescriptUse = (file: string): ImportDetails => ({
  packageName: 'typescript',
  importType: 'runtime',
  context: 'development',
  file,
  line: 1,
  importStatement: path.basename(file),
});

const asTypeOnly = (detail: ImportDetails): ImportDetails => ({
  ...detail,
  importType: 'type-only',
});

export const parseFile = (
  source: SourceFile,
): Result.Result<ReadonlyArray<ImportDetails>, FileError> =>
  Match.value(sourceKindOf(source.path)).pipe(
    Match.when('tsconfig', () => Result.succeed([typescriptUse(source.path)])),
    Match.when('declaration', () =>
      Result.map(readImports(source), (found) => [
        ...Array.map(found, asTypeOnly),
        typescriptUse(source.path),
      ]),
    ),
    Match.when('typescript', () =>
      Result.map(readImports(source), Array.append(typescriptUse(source.path))),
    ),
    Match.when('javascript', () => readImports(source)),
    Match.when('component', () => readComponentImports(source)),
    Match.when('stylesheet', () => readStylesheetImports(source)),
    Match.exhaustive,
  );

type ParsedSources = {
  readonly imports: ReadonlyArray<ImportDetails>;
  readonly unreadable: ReadonlyArray<FileError>;
};

export const parseMultipleFiles = (sources: ReadonlyArray<SourceFile>): ParsedSources => {
  const [unreadable, parsed] = Array.partition(sources, parseFile);
  return { imports: Array.flatten(parsed), unreadable };
};

const detectedBuildDirectories = (rootDir: string): Gathered<string> => {
  const tsconfigs = readRootTsConfigs(rootDir);
  return gatherAll([
    { found: [], skipped: tsconfigs.skipped },
    detectBuildDirectories(rootDir, tsconfigs.found),
    detectByHeuristic(rootDir),
  ]);
};

const anchoredDirectory = (dir: string): string => path.posix.join('/', dir, '/');

// A leading slash anchors a .gitignore pattern at rootDir, so a path under rootDir becomes one.
const anchoredExclude =
  (rootDir: string) =>
  (pattern: string): string =>
    Match.value(pattern).pipe(
      Match.when(String.startsWith(`${rootDir}${path.sep}`), (absolute) =>
        path.posix.join('/', path.relative(rootDir, absolute)),
      ),
      Match.when(String.startsWith('./'), (relative) => relative.slice(1)),
      Match.orElse((kept) => kept),
    );

const byPath = Order.mapInput(Order.String, (file: SourceFile) => file.path);

const directoryOf = (relativePath: string): string =>
  pipe(path.posix.dirname(relativePath), (dir) => (dir === '.' ? '' : dir));

const governingTsConfigs = (
  rootDir: string,
  sources: ReadonlyArray<{ readonly path: string; readonly layoutRoots: ReadonlyArray<string> }>,
): Gathered<TsConfigChain> =>
  readTsConfigChains(
    pipe(
      sources,
      Array.filter(
        (source) =>
          isTsConfig(source.path) && Array.contains(source.layoutRoots, directoryOf(source.path)),
      ),
      Array.map((source) => path.resolve(rootDir, source.path)),
      (roots) => Array.sort(roots, Order.String),
    ),
  );

export const findFiles = (
  rootDir: string,
  options: {
    readonly excludePatterns?: ReadonlyArray<string>;
    readonly noAutoDetect?: boolean;
  } = {},
): Gathered<SourceFile> & {
  readonly unreadable: ReadonlyArray<FileError>;
  readonly packages: ReadonlyArray<LeftOut>;
  readonly tsconfigs: ReadonlyArray<TsConfigChain>;
  readonly layoutRoots: ReadonlyArray<string>;
  readonly manifests: ReadonlyArray<LayoutManifest>;
} => {
  const detected = options.noAutoDetect ? gatherAll<string>([]) : detectedBuildDirectories(rootDir);
  const walked = walkProject(rootDir, {
    always: [
      ...ALWAYS_EXCLUDED,
      ...Array.map(detected.found, anchoredDirectory),
      ...Array.map(options.excludePatterns ?? [], anchoredExclude(path.resolve(rootDir))),
    ],
    atLayoutRoots: BUILD_OUTPUT_DIRECTORIES,
    withoutGitignore: EXCLUDED_WITHOUT_GITIGNORE,
    isSource: shouldAnalyzeFile,
  });
  const layoutRoots = Array.sort(Array.prepend(walked.layoutRoots, ''), Order.String);
  // The walk already reports a layout root's broken package.json.
  const manifests = gatherAll(
    Array.map(layoutRoots, (root) =>
      gatherOptional(Result.map(readLayoutManifest(rootDir)(root), Array.of)),
    ),
  );
  const contextOf = fileContextOf(Array.flatMap(manifests.found, (manifest) => manifest.bins));
  const tsconfigs = governingTsConfigs(rootDir, walked.found);
  const emitOf = emitSettingsOf(tsconfigs.found);
  return {
    found: pipe(
      walked.found,
      Array.map((source): SourceFile => {
        const absolute = path.resolve(rootDir, source.path);
        return { path: absolute, context: contextOf(source), emit: emitOf(absolute) };
      }),
      (files) => Array.sort(files, byPath),
    ),
    // Build-directory detection reads the root tsconfig files too.
    skipped: Array.dedupe([...detected.skipped, ...walked.skipped, ...tsconfigs.skipped]),
    unreadable: walked.unreadable,
    packages: Array.map(walked.packages, ({ dir, files }) => ({
      dir: path.join(rootDir, dir),
      files: Array.map(files, (file) => path.resolve(rootDir, file)),
    })),
    tsconfigs: tsconfigs.found,
    layoutRoots: Array.map(layoutRoots, (root) => path.join(rootDir, root)),
    manifests: manifests.found,
  };
};

// A peer declaration installs nothing in the package itself.
const INSTALLED_SECTIONS = [
  'dependencies',
  'devDependencies',
] as const satisfies ReadonlyArray<DependencyType>;

const installs =
  (packageJson: PackageJson) =>
  (name: PackageName): boolean =>
    Array.some(INSTALLED_SECTIONS, (section) => Array.contains(packageJson[section], name));

// Node resolves what a left-out package does not install from the root install. Read as
// development use, such an import marks a root dependency used but never misplaced or type-only.
const hoistedImportsOf = (leftOut: LeftOut): Result.Result<ParsedSources, FileError> =>
  Result.map(readPackageJson(path.join(leftOut.dir, 'package.json')), (declared) => {
    const parsed = parseMultipleFiles(
      Array.map(leftOut.files, (file): SourceFile => ({
        path: file,
        context: 'development',
        emit: UNCONFIGURED,
      })),
    );
    return {
      ...parsed,
      imports: Array.filter(parsed.imports, (detail) => !installs(declared)(detail.packageName)),
    };
  });

export const parseHoistedImports = (
  packages: ReadonlyArray<LeftOut>,
): ParsedSources & { readonly skipped: ReadonlyArray<FileError> } => {
  const [skipped, parsed] = Array.partition(packages, hoistedImportsOf);
  return {
    imports: Array.flatMap(parsed, (sources) => sources.imports),
    unreadable: Array.flatMap(parsed, (sources) => sources.unreadable),
    skipped,
  };
};
