import path from 'node:path';
import type {
  Argument,
  CallExpression,
  Program,
  TSGlobalDeclaration,
  TSImportEqualsDeclaration,
  TSModuleDeclaration,
} from '@oxc-project/types';
import { Array, Match, Option, Order, Record, Result, String, pipe } from 'effect';
import {
  type Comment,
  type DynamicImport,
  type ParseResult,
  type ParserOptions,
  type StaticExport,
  type StaticImport,
  Visitor,
  parseSync,
} from 'oxc-parser';
import {
  ALWAYS_EXCLUDED,
  ANALYZABLE_EXTENSIONS,
  BUILD_OUTPUT_DIRECTORIES,
  DECLARATION_FILE_PATTERN,
  DEVELOPMENT_DIRECTORIES,
  DEVELOPMENT_FILENAME_PATTERNS,
  EXCLUDED_WITHOUT_GITIGNORE,
  ROOT_TOOLING_DIRECTORIES,
  ROOT_TOOL_CONFIG_PATTERN,
  TSCONFIG_FILE_PATTERN,
  TYPESCRIPT_EXTENSIONS,
} from '../constants/patterns.js';
import type { FileError } from '../domain/errors.js';
import {
  type DependencyType,
  type FileContext,
  type Gathered,
  type ImportDetails,
  type ImportType,
  type PackageJson,
  type PackageName,
  type SourceFile,
} from '../domain/types.js';
import { readPackageJson } from './package-parser.js';
import { detectBuildDirectories, detectByHeuristic } from '../utils/detect-build-dirs.js';
import { gatherAll, readFile } from '../utils/file-reader.js';
import { buildLineStarts, lineNumberAt } from '../utils/line-index.js';
import { type LeftOut, walkProject } from '../utils/project-walk.js';
import { readRootTsConfigs } from '../utils/tsconfig-reader.js';

const PACKAGE_NAME = /^(?![./]|https?:|file:)(@[^/]+\/[^/]+|[^@/][^/]*)/;

export const extractPackageName = (specifier: string): Option.Option<string> =>
  Option.fromNullishOr(PACKAGE_NAME.exec(specifier)?.[1]);

const hasAnalyzableExtension = (filePath: string): boolean =>
  Array.contains(ANALYZABLE_EXTENSIONS, path.extname(filePath));

const isTsConfig = (filePath: string): boolean =>
  TSCONFIG_FILE_PATTERN.test(path.basename(filePath));

export const shouldAnalyzeFile = (filePath: string): boolean =>
  hasAnalyzableExtension(filePath) || isTsConfig(filePath);

type SourceKind = 'tsconfig' | 'declaration' | 'typescript' | 'javascript';

const sourceKindOf = (filePath: string): SourceKind =>
  Match.value(filePath).pipe(
    Match.when(isTsConfig, (): SourceKind => 'tsconfig'),
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

export const fileContextOf = (source: {
  readonly path: string;
  readonly layoutRoots: ReadonlyArray<string>;
}): FileContext => {
  const placement: Placement = {
    segments: segmentsOf(source.path),
    fromLayoutRoots: Array.map(source.layoutRoots, (root) =>
      segmentsOf(path.posix.relative(root, source.path)),
    ),
  };
  return Array.some(isDevelopmentPath, (matches) => matches(placement))
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

const staticImportReference = (statement: StaticImport): ModuleReference =>
  referenceAt(
    statement.moduleRequest.value,
    Array.isReadonlyArrayNonEmpty(statement.entries) &&
      Array.every(statement.entries, (entry) => entry.isType),
    statement,
  );

const reExportReference = (statement: StaticExport): Option.Option<ModuleReference> =>
  pipe(
    statement.entries,
    Array.map((entry) => Option.fromNullishOr(entry.moduleRequest)),
    Array.getSomes,
    Array.head,
    Option.map((request) =>
      referenceAt(
        request.value,
        Array.every(statement.entries, (entry) => entry.isType),
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

// ESM comes from oxc's module record without materialising the AST. The other forms need the AST;
// oxc's Visitor walks 15.7k lines in 31ms where a pure recursive fold took 139ms.
const astReferences = (program: Program): AstReferences => {
  const references: ModuleReference[] = [];
  const augmentations: ModuleReference[] = [];
  new Visitor({
    CallExpression: (node) => references.push(...requireReference(node)),
    TSImportEqualsDeclaration: (node) => references.push(...importEqualsReference(node)),
    TSImportType: (node) => references.push(referenceAt(node.source.value, true, node)),
    TSModuleDeclaration: (node) => augmentations.push(...augmentationReference(node)),
  }).visit(program);
  return { references, augmentations };
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

const parse = (content: string, filePath: string): ParseResult =>
  parseSync(
    filePath,
    content,
    Option.getOrUndefined(Record.get(OPTIONS_BY_EXTENSION, path.extname(filePath))),
  );

const moduleReferences = (content: string, filePath: string): ReadonlyArray<ModuleReference> => {
  const parsed = parse(content, filePath);
  const ast =
    AST_MARKER.test(content) || hasTypeImport(content, parsed)
      ? astReferences(parsed.program)
      : NO_AST_REFERENCES;
  return [
    ...Array.map(parsed.module.staticImports, staticImportReference),
    ...Array.getSomes(Array.map(parsed.module.staticExports, reExportReference)),
    ...Array.getSomes(Array.map(parsed.module.dynamicImports, dynamicImportReference(content))),
    ...ast.references,
    ...(parsed.module.hasModuleSyntax ? ast.augmentations : []),
    ...(COMMENT_MARKER.test(content) ? Array.flatMap(parsed.comments, commentReferences) : []),
  ];
};

type FileImport = Omit<ImportDetails, 'context'>;

export const extractImports = (content: string, filePath: string): ReadonlyArray<FileImport> => {
  const lineStarts = buildLineStarts(content);

  return pipe(
    moduleReferences(content, filePath),
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

const readImports = (source: SourceFile): Result.Result<ReadonlyArray<ImportDetails>, FileError> =>
  pipe(
    readFile(source.path),
    Result.map((content) =>
      Array.map(extractImports(content, source.path), (found): ImportDetails => ({
        ...found,
        context: source.context,
      })),
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

export const findFiles = (
  rootDir: string,
  options: {
    readonly excludePatterns?: ReadonlyArray<string>;
    readonly noAutoDetect?: boolean;
  } = {},
): Gathered<SourceFile> & { readonly packages: ReadonlyArray<LeftOut> } => {
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
  return {
    found: pipe(
      walked.found,
      Array.map((source) => ({
        path: path.resolve(rootDir, source.path),
        context: fileContextOf(source),
      })),
      (files) => Array.sort(files, byPath),
    ),
    skipped: [...detected.skipped, ...walked.skipped],
    packages: Array.map(walked.packages, ({ dir, files }) => ({
      dir: path.join(rootDir, dir),
      files: Array.map(files, (file) => path.resolve(rootDir, file)),
    })),
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
      Array.map(leftOut.files, (file): SourceFile => ({ path: file, context: 'development' })),
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
