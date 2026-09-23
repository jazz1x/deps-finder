import path from 'node:path';
import { A, O, R, S, pipe } from '@mobily/ts-belt';
import type { CallExpression, Program, TSImportEqualsDeclaration } from '@oxc-project/types';
import { globSync } from 'glob';
import {
  type DynamicImport,
  type StaticExport,
  type StaticImport,
  Visitor,
  parseSync,
} from 'oxc-parser';
import { P, match } from 'ts-pattern';
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
import { isNotNullable, isString } from '../utils/type-guards.js';

export const extractPackageName = (importPath: string | undefined | null): string | null => {
  return match(importPath)
    .with(P.nullish, () => null)
    .with(
      P.when((p) => !isString(p) || S.isEmpty(p)),
      () => null,
    )
    .with(
      P.when((p) => /^(?:http|https|file):/.test(p as string)),
      () => null,
    )
    .with(
      P.when((p) => S.startsWith(p as string, '.') || S.startsWith(p as string, '/')),
      () => null,
    )
    .with(
      P.when((p) => S.startsWith(p as string, '@')),
      (p) => {
        const parts = S.split(p as string, '/');
        return A.length(parts) >= 2 && S.isNotEmpty(parts[1] ?? '')
          ? `${parts[0]}/${parts[1]}`
          : null;
      },
    )
    .otherwise((p) => pipe(p as string, S.split('/'), A.head, O.toNullable));
};

/**
 * 내장 모듈 여부 확인 — 모듈 로드 시 한 번 만든 Set으로 O(1) 룩업.
 */
export const isBuiltinModule = (packageName: string): boolean =>
  BUILTIN_MODULE_SET.has(packageName);

const hasAnalyzableExtension = (filePath: string): boolean =>
  pipe(filePath, path.extname, (ext) =>
    A.some(ANALYZABLE_EXTENSIONS, (allowed) => allowed === ext),
  );

export const isProductionConfigFile = (filePath: string): boolean =>
  pipe(filePath, path.basename, (filename) =>
    A.some(PRODUCTION_CONFIG_PATTERNS, (pattern) => pattern.test(filename)),
  );

export const isExcludedPath = (filePath: string): boolean => {
  const rawNormalized = S.replaceByRe(filePath, /\\/g, '/');
  const normalizedPath = S.startsWith(rawNormalized, '/') ? rawNormalized : `/${rawNormalized}`;
  const filename = path.basename(filePath);

  return (
    A.some(EXCLUDED_DIRECTORY_PATTERNS, (pattern) =>
      S.includes(normalizedPath, S.startsWith(pattern, '/') ? pattern : `/${pattern}`),
    ) ||
    A.some(EXCLUDED_FILENAME_PATTERNS, (pattern) => S.includes(filename, pattern)) ||
    A.some(DEV_CONFIG_PATTERNS, (pattern) => S.includes(filename, pattern))
  );
};

export const shouldAnalyzeFile = (filePath: string): boolean => {
  return match(filePath)
    .with(
      P.when((p) => DECLARATION_FILE_PATTERN.test(p)),
      () => false,
    )
    .with(
      P.when((p) => !hasAnalyzableExtension(p)),
      () => false,
    )
    .with(P.when(isProductionConfigFile), () => true)
    .with(P.when(isExcludedPath), () => false)
    .otherwise(() => true);
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
    A.isNotEmpty(statement.entries) && A.every(statement.entries, (entry) => entry.isType),
    statement,
  );

const reExportReference = (statement: StaticExport): O.Option<ModuleReference> => {
  const reExported = A.filter(statement.entries, (entry) => isNotNullable(entry.moduleRequest));
  return pipe(
    A.head(reExported),
    O.flatMap((entry) => O.fromNullable(entry.moduleRequest)),
    O.map((request) =>
      referenceAt(
        request.value,
        A.every(reExported, (entry) => entry.isType),
        statement,
      ),
    ),
  );
};

const QUOTED = /^(['"])(.*)\1$/s;

const dynamicImportReference =
  (content: string) =>
  (expression: DynamicImport): O.Option<ModuleReference> =>
    pipe(
      O.fromNullable(
        QUOTED.exec(content.slice(expression.moduleRequest.start, expression.moduleRequest.end)),
      ),
      O.flatMap((quoted) => O.fromNullable(quoted[2])),
      O.map((specifier) => referenceAt(specifier, false, expression)),
    );

const STRING_LITERAL = { type: 'Literal', value: P.string } as const;

const commonJsReference = (
  node: CallExpression | TSImportEqualsDeclaration,
): ReadonlyArray<ModuleReference> =>
  match(node)
    .with(
      {
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'require' },
        arguments: [STRING_LITERAL],
      },
      (call) => [referenceAt(call.arguments[0].value, false, call)],
    )
    .with(
      {
        type: 'TSImportEqualsDeclaration',
        moduleReference: { type: 'TSExternalModuleReference', expression: STRING_LITERAL },
      },
      (decl) => [
        referenceAt(decl.moduleReference.expression.value, decl.importKind === 'type', decl),
      ],
    )
    .otherwise(() => []);

// ESM comes from oxc's module record without materialising the AST. CommonJS needs the AST;
// oxc's Visitor walks 15.7k lines in 31ms where a pure recursive fold took 139ms.
const commonJsReferences = (program: Program): ReadonlyArray<ModuleReference> => {
  const found: ModuleReference[] = [];
  new Visitor({
    CallExpression: (node) => found.push(...commonJsReference(node)),
    TSImportEqualsDeclaration: (node) => found.push(...commonJsReference(node)),
  }).visit(program);
  return found;
};

const moduleReferences = (content: string, filePath: string): ReadonlyArray<ModuleReference> => {
  const parsed = parseSync(filePath, content);
  return [
    ...A.map(parsed.module.staticImports, staticImportReference),
    ...A.filterMap(parsed.module.staticExports, reExportReference),
    ...A.filterMap(parsed.module.dynamicImports, dynamicImportReference(content)),
    ...(S.includes(content, 'require') ? commonJsReferences(parsed.program) : []),
  ];
};

export const extractImports = (content: string, filePath: string): ReadonlyArray<ImportDetails> => {
  const lineStarts = buildLineStarts(content);

  return pipe(
    moduleReferences(content, filePath),
    A.filterMap((ref) =>
      pipe(
        O.fromNullable(extractPackageName(ref.specifier)),
        O.filter((packageName) => !isBuiltinModule(packageName)),
        O.map((packageName): ImportDetails => ({
          packageName,
          importType: ref.importType,
          file: filePath,
          line: lineNumberAt(lineStarts, ref.start),
          importStatement: content.slice(ref.start, ref.end).trim(),
        })),
      ),
    ),
  );
};

export const parseFile = (filePath: string): R.Result<ReadonlyArray<ImportDetails>, FileError> => {
  return pipe(
    readFile(filePath),
    R.map((content) => extractImports(content, filePath)),
  );
};

export const parseMultipleFiles = (
  filePaths: ReadonlyArray<string>,
): ReadonlyArray<ImportDetails> => {
  return pipe(filePaths, A.map(parseFile), A.filter(R.isOk), A.map(R.getExn), A.flat);
};

export const findFiles = (
  rootDir: string,
  options: {
    excludePatterns?: ReadonlyArray<string>;
    noAutoDetect?: boolean;
  } = {},
): readonly string[] => {
  const ignorePatterns = [
    ...getAllExcludedPatterns(rootDir, !options.noAutoDetect),
    ...(options.excludePatterns || []),
  ];

  return pipe(
    globSync('**/*', {
      cwd: rootDir,
      nodir: true,
      ignore: ignorePatterns as string[],
    }),
    A.filter(shouldAnalyzeFile),
    A.map((relativePath) => path.resolve(rootDir, relativePath)),
  );
};
