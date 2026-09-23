import path from 'node:path';
import type {
  Argument,
  CallExpression,
  Program,
  TSImportEqualsDeclaration,
} from '@oxc-project/types';
import { Array, Match, Option, Result, String, pipe } from 'effect';
import { globSync } from 'glob';
import {
  type DynamicImport,
  type StaticExport,
  type StaticImport,
  Visitor,
  parseSync,
} from 'oxc-parser';
import {
  ANALYZABLE_EXTENSIONS,
  DECLARATION_FILE_PATTERN,
  DEVELOPMENT_DIRECTORIES,
  DEVELOPMENT_FILENAME_PATTERNS,
  ROOT_TOOLING_DIRECTORIES,
  ROOT_TOOL_CONFIG_PATTERN,
  getAllExcludedPatterns,
} from '../constants/patterns.js';
import type { FileError } from '../domain/errors.js';
import type { FileContext, ImportDetails, ImportType, SourceFile } from '../domain/types.js';
import { readFile } from '../utils/file-reader.js';
import { buildLineStarts, lineNumberAt } from '../utils/line-index.js';

const PACKAGE_NAME = /^(?![./]|https?:|file:)(@[^/]+\/[^/]+|[^@/][^/]*)/;

export const extractPackageName = (specifier: string): Option.Option<string> =>
  Option.fromNullishOr(PACKAGE_NAME.exec(specifier)?.[1]);

const hasAnalyzableExtension = (filePath: string): boolean =>
  Array.contains(ANALYZABLE_EXTENSIONS, path.extname(filePath));

export const shouldAnalyzeFile = (filePath: string): boolean =>
  !DECLARATION_FILE_PATTERN.test(filePath) && hasAnalyzableExtension(filePath);

type PathSegments = Array.NonEmptyReadonlyArray<string>;

const isDevelopmentPath: ReadonlyArray<(segments: PathSegments) => boolean> = [
  (segments) =>
    Array.some(Array.initNonEmpty(segments), (dir) => Array.contains(DEVELOPMENT_DIRECTORIES, dir)),
  (segments) => Array.some(segments, String.startsWith('.')),
  (segments) =>
    Array.some(DEVELOPMENT_FILENAME_PATTERNS, (pattern) =>
      Array.lastNonEmpty(segments).includes(pattern),
    ),
  (segments) => segments.length === 1 && ROOT_TOOL_CONFIG_PATTERN.test(segments[0]),
  (segments) =>
    segments.length > 1 && Array.contains(ROOT_TOOLING_DIRECTORIES, Array.headNonEmpty(segments)),
];

export const fileContextOf = (relativePath: string): FileContext => {
  const segments = String.split(relativePath, /[\\/]/);
  return Array.some(isDevelopmentPath, (matches) => matches(segments))
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

// ESM comes from oxc's module record without materialising the AST. CommonJS needs the AST;
// oxc's Visitor walks 15.7k lines in 31ms where a pure recursive fold took 139ms.
const commonJsReferences = (program: Program): ReadonlyArray<ModuleReference> => {
  const found: ModuleReference[] = [];
  new Visitor({
    CallExpression: (node) => found.push(...requireReference(node)),
    TSImportEqualsDeclaration: (node) => found.push(...importEqualsReference(node)),
  }).visit(program);
  return found;
};

const moduleReferences = (content: string, filePath: string): ReadonlyArray<ModuleReference> => {
  const parsed = parseSync(filePath, content);
  return [
    ...Array.map(parsed.module.staticImports, staticImportReference),
    ...Array.getSomes(Array.map(parsed.module.staticExports, reExportReference)),
    ...Array.getSomes(Array.map(parsed.module.dynamicImports, dynamicImportReference(content))),
    ...(content.includes('require') ? commonJsReferences(parsed.program) : []),
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

export const parseFile = (
  source: SourceFile,
): Result.Result<ReadonlyArray<ImportDetails>, FileError> =>
  pipe(
    readFile(source.path),
    Result.map((content) =>
      Array.map(extractImports(content, source.path), (found): ImportDetails => ({
        ...found,
        context: source.context,
      })),
    ),
  );

type ParsedSources = {
  readonly imports: ReadonlyArray<ImportDetails>;
  readonly unreadable: ReadonlyArray<FileError>;
};

export const parseMultipleFiles = (sources: ReadonlyArray<SourceFile>): ParsedSources => {
  const [unreadable, parsed] = Array.partition(sources, parseFile);
  return { imports: Array.flatten(parsed), unreadable };
};

export const findFiles = (
  rootDir: string,
  options: {
    readonly excludePatterns?: ReadonlyArray<string>;
    readonly noAutoDetect?: boolean;
  } = {},
): ReadonlyArray<SourceFile> =>
  pipe(
    globSync('**/*', {
      cwd: rootDir,
      nodir: true,
      dot: true,
      ignore: [
        ...getAllExcludedPatterns(rootDir, !options.noAutoDetect),
        ...(options.excludePatterns ?? []),
      ],
    }),
    Array.filter(shouldAnalyzeFile),
    Array.map((relativePath) => ({
      path: path.resolve(rootDir, relativePath),
      context: fileContextOf(relativePath),
    })),
  );
