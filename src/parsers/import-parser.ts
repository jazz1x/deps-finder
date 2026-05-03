import path from 'node:path';
import { A, O, R, S, pipe } from '@mobily/ts-belt';
import { globSync } from 'glob';
import { P, match } from 'ts-pattern';
import {
  ANALYZABLE_EXTENSIONS,
  BUILTIN_MODULE_SET,
  DEV_CONFIG_PATTERNS,
  EXCLUDED_DIRECTORY_PATTERNS,
  EXCLUDED_FILENAME_PATTERNS,
  IMPORT_REGEX,
  MIXED_TYPE_IMPORT_REGEX,
  MULTILINE_COMMENT_REGEX,
  PRODUCTION_CONFIG_PATTERNS,
  SINGLE_LINE_COMMENT_REGEX,
  TYPE_ONLY_IMPORT_REGEX,
  getAllExcludedPatterns,
} from '../constants/patterns.js';
import type { FileError } from '../domain/errors.js';
import type { ImportDetails } from '../domain/types.js';
import { readFile } from '../utils/file-reader.js';
import { buildLineStarts, lineNumberAt } from '../utils/line-index.js';
import { isNotNullable, isString } from '../utils/type-guards.js';

export const removeComments = (code: string): string => {
  return code
    .replace(MULTILINE_COMMENT_REGEX, (matchedStr) => {
      // 매치된 문자열 내의 줄바꿈 개수만큼 줄바꿈 문자 유지
      const newlines = (matchedStr.match(/\n/g) || []).join('');
      return newlines;
    })
    .replace(SINGLE_LINE_COMMENT_REGEX, '');
};

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

const execAll = (regex: RegExp, text: string): RegExpExecArray[] => {
  const matches: RegExpExecArray[] = [];
  regex.lastIndex = 0;

  let match = regex.exec(text);
  while (match !== null) {
    matches.push(match);
    match = regex.exec(text);
  }
  return matches;
};

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

  return match({ normalizedPath, filename })
    .with(
      P.when(({ normalizedPath }) =>
        A.some(EXCLUDED_DIRECTORY_PATTERNS, (pattern) => {
          const cleanPattern = S.startsWith(pattern, '/') ? pattern : `/${pattern}`;
          return S.includes(normalizedPath, cleanPattern);
        }),
      ),
      () => true,
    )
    .with(
      P.when(({ filename }) =>
        A.some(EXCLUDED_FILENAME_PATTERNS, (pattern) => S.includes(filename, pattern)),
      ),
      () => true,
    )
    .with(
      P.when(({ filename }) =>
        A.some(DEV_CONFIG_PATTERNS, (pattern) => S.includes(filename, pattern)),
      ),
      () => true,
    )
    .otherwise(() => false);
};

export const shouldAnalyzeFile = (filePath: string): boolean => {
  return match(filePath)
    .with(
      P.when((p) => p.endsWith('.d.ts')),
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

export const extractImports = (fileContent: string, filePath: string): ImportDetails[] => {
  const content = removeComments(fileContent);
  // 라인 인덱스를 한 번만 만들어두고 매치마다 O(log L) 룩업으로 줄 번호를 구한다.
  const lineStarts = buildLineStarts(content);
  const lineOf = (offset: number): number => lineNumberAt(lineStarts, offset);

  // Pass 1: Initialize packages. Assume runtime initially for all general imports.
  // IMPORT_REGEX already includes a require() alternation, so no separate REQUIRE_REGEX pass is needed.
  const fromGeneral = pipe(
    execAll(IMPORT_REGEX, content),
    A.filterMap((m): O.Option<ImportDetails> => {
      const packageName = extractPackageName(m[1] ?? m[2]);
      return isNotNullable(packageName) && !isBuiltinModule(packageName)
        ? {
            packageName,
            importType: 'runtime',
            file: filePath,
            line: lineOf(m.index),
            importStatement: m[0].trim(),
          }
        : O.None;
    }),
  );

  // Pass 2: Refine for explicit `import type X from 'pkg'` statements.
  const fromTypeOnly = pipe(
    execAll(TYPE_ONLY_IMPORT_REGEX, content),
    A.filterMap((m): O.Option<ImportDetails> => {
      const packageName = extractPackageName(m[1]);
      return isNotNullable(packageName) && !isBuiltinModule(packageName)
        ? {
            packageName,
            importType: 'type-only',
            file: filePath,
            line: lineOf(m.index),
            importStatement: m[0].trim(),
          }
        : O.None;
    }),
  );

  // Pass 3: Refine for `import { type X, Y } from 'pkg'` or `import { type X } from 'pkg'` statements.
  const fromMixed = pipe(
    execAll(MIXED_TYPE_IMPORT_REGEX, content),
    A.filterMap((m): O.Option<ImportDetails> => {
      const fullImportStr = m[1];
      const packageName = extractPackageName(m[2]);
      if (!isNotNullable(packageName) || isBuiltinModule(packageName)) return O.None;
      if (!isNotNullable(fullImportStr) || !fullImportStr.includes('type ')) return O.None;
      const hasRuntimeSpecifier = pipe(
        S.split(fullImportStr, ','),
        A.some((spec) => !S.includes(spec.trim(), 'type ')),
      );
      return {
        packageName,
        importType: hasRuntimeSpecifier ? 'runtime' : 'type-only',
        file: filePath,
        line: lineOf(m.index),
        importStatement: m[0].trim(),
      };
    }),
  );

  return [...fromGeneral, ...fromTypeOnly, ...fromMixed];
};

export const parseFile = (filePath: string): R.Result<ImportDetails[], FileError> => {
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

  const files = globSync('**/*', {
    cwd: rootDir,
    absolute: true,
    nodir: true,
    ignore: ignorePatterns as string[],
  });

  return A.filter(files, shouldAnalyzeFile);
};
