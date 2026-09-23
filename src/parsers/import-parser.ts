import path from 'node:path';
import type {
  Argument,
  CallExpression,
  Program,
  TSImportEqualsDeclaration,
} from '@oxc-project/types';
import { Array, Match, Option, Result, pipe } from 'effect';
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
  BUILTIN_MODULE_SET,
  DECLARATION_FILE_PATTERN,
  DEV_CONFIG_PATTERNS,
  EXCLUDED_DIRECTORY_PATTERNS,
  EXCLUDED_FILENAME_PATTERNS,
  PRODUCTION_CONFIG_PATTERNS,
  getAllExcludedPatterns,
} from '../constants/patterns.js';
import type { FileError } from '../domain/errors.js';
import type { ImportDetails, ImportType } from '../domain/types.js';
import { readFile } from '../utils/file-reader.js';
import { buildLineStarts, lineNumberAt } from '../utils/line-index.js';

const PACKAGE_NAME = /^(?![./]|https?:|file:)(@[^/]+\/[^/]+|[^@/][^/]*)/;

export const extractPackageName = (specifier: string): Option.Option<string> =>
  Option.fromNullishOr(PACKAGE_NAME.exec(specifier)?.[1]);

export const isBuiltinModule = (packageName: string): boolean =>
  BUILTIN_MODULE_SET.has(packageName);

const hasAnalyzableExtension = (filePath: string): boolean =>
  Array.contains(ANALYZABLE_EXTENSIONS, path.extname(filePath));

export const isProductionConfigFile = (filePath: string): boolean =>
  Array.some(PRODUCTION_CONFIG_PATTERNS, (pattern) => pattern.test(path.basename(filePath)));

export const isExcludedPath = (filePath: string): boolean => {
  const normalizedPath = `/${filePath.replaceAll('\\', '/').replace(/^\//, '')}`;
  const filename = path.basename(filePath);

  return (
    Array.some(EXCLUDED_DIRECTORY_PATTERNS, (pattern) =>
      normalizedPath.includes(pattern.startsWith('/') ? pattern : `/${pattern}`),
    ) ||
    Array.some(EXCLUDED_FILENAME_PATTERNS, (pattern) => filename.includes(pattern)) ||
    Array.some(DEV_CONFIG_PATTERNS, (pattern) => filename.includes(pattern))
  );
};

export const shouldAnalyzeFile = (filePath: string): boolean =>
  !DECLARATION_FILE_PATTERN.test(filePath) &&
  hasAnalyzableExtension(filePath) &&
  (isProductionConfigFile(filePath) || !isExcludedPath(filePath));

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

export const extractImports = (content: string, filePath: string): ReadonlyArray<ImportDetails> => {
  const lineStarts = buildLineStarts(content);

  return pipe(
    moduleReferences(content, filePath),
    Array.map((ref) =>
      pipe(
        extractPackageName(ref.specifier),
        Option.filter((packageName) => !isBuiltinModule(packageName)),
        Option.map((packageName): ImportDetails => ({
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
  filePath: string,
): Result.Result<ReadonlyArray<ImportDetails>, FileError> =>
  pipe(
    readFile(filePath),
    Result.map((content) => extractImports(content, filePath)),
  );

export type ParsedSources = {
  readonly imports: ReadonlyArray<ImportDetails>;
  readonly unreadable: ReadonlyArray<FileError>;
};

export const parseMultipleFiles = (filePaths: ReadonlyArray<string>): ParsedSources => {
  const [unreadable, parsed] = Array.partition(filePaths, parseFile);
  return { imports: Array.flatten(parsed), unreadable };
};

export const findFiles = (
  rootDir: string,
  options: {
    readonly excludePatterns?: ReadonlyArray<string>;
    readonly noAutoDetect?: boolean;
  } = {},
): ReadonlyArray<string> =>
  pipe(
    globSync('**/*', {
      cwd: rootDir,
      nodir: true,
      ignore: [
        ...getAllExcludedPatterns(rootDir, !options.noAutoDetect),
        ...(options.excludePatterns ?? []),
      ],
    }),
    Array.filter(shouldAnalyzeFile),
    Array.map((relativePath) => path.resolve(rootDir, relativePath)),
  );
