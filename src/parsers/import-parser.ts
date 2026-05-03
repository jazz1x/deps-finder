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
  REQUIRE_REGEX,
  SINGLE_LINE_COMMENT_REGEX,
  TYPE_ONLY_IMPORT_REGEX,
  getAllExcludedPatterns,
} from '../constants/patterns.js';
import type { FileError } from '../domain/errors.js';
import type { ImportDetails } from '../domain/types.js';
import { readFile } from '../utils/file-reader.js';
import { buildLineStarts, lineNumberAt } from '../utils/line-index.js';
import { isNotNullable, isString } from '../utils/type-guards.js';

/**
 * 주석 제거 (줄바꿈 보존)
 */
export const removeComments = (code: string): string => {
  return code
    .replace(MULTILINE_COMMENT_REGEX, (match) => {
      // 매치된 문자열 내의 줄바꿈 개수만큼 줄바꿈 문자 유지
      const newlines = (match.match(/\n/g) || []).join('');
      return newlines;
    })
    .replace(SINGLE_LINE_COMMENT_REGEX, '');
};

/**
 * 패키지명 추출
 */
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

/**
 * 정규식 매칭 결과를 배열로 변환
 */
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

/**
 * 파일 확장자 확인
 */
const hasAnalyzableExtension = (filePath: string): boolean =>
  pipe(filePath, path.extname, (ext) =>
    A.some(ANALYZABLE_EXTENSIONS, (allowed) => allowed === ext),
  );

/**
 * 프로덕션 config 파일 여부
 */
export const isProductionConfigFile = (filePath: string): boolean =>
  pipe(filePath, path.basename, (filename) =>
    A.some(PRODUCTION_CONFIG_PATTERNS, (pattern) => pattern.test(filename)),
  );

/**
 * 제외 대상 경로 여부
 */
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

/**
 * 분석 대상 파일 여부
 */
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

  const findings: ImportDetails[] = [];

  // Pass 1: Initialize packages. Assume runtime initially for all general imports.
  const allGeneralImportMatches = [
    ...execAll(IMPORT_REGEX, content),
    ...execAll(REQUIRE_REGEX, content),
  ];

  A.forEach(allGeneralImportMatches, (match) => {
    const packageName = extractPackageName(match[1] ?? match[2]);
    if (isNotNullable(packageName) && !isBuiltinModule(packageName)) {
      findings.push({
        packageName,
        importType: 'runtime',
        file: filePath,
        line: lineOf(match.index),
        importStatement: match[0].trim(),
      });
    }
  });

  // Pass 2: Refine for explicit `import type X from 'pkg'` statements.
  const typeOnlyMatches = execAll(TYPE_ONLY_IMPORT_REGEX, content);
  A.forEach(typeOnlyMatches, (match) => {
    const packageName = extractPackageName(match[1]);
    if (isNotNullable(packageName) && !isBuiltinModule(packageName)) {
      findings.push({
        packageName,
        importType: 'type-only',
        file: filePath,
        line: lineOf(match.index),
        importStatement: match[0].trim(),
      });
    }
  });

  // Pass 3: Refine for `import { type X, Y } from 'pkg'` or `import { type X } from 'pkg'` statements.
  const mixedTypeMatches = execAll(MIXED_TYPE_IMPORT_REGEX, content);
  A.forEach(mixedTypeMatches, (match) => {
    const fullImportStr = match[1];
    const pkgPath = match[2];
    const packageName = extractPackageName(pkgPath);

    if (!isNotNullable(packageName) || isBuiltinModule(packageName)) return;
    if (!isNotNullable(fullImportStr)) return;

    if (!fullImportStr.includes('type ')) return;

    const hasRuntimeSpecifier = pipe(
      S.split(fullImportStr, ','),
      A.some((spec) => !S.includes(spec.trim(), 'type ')),
    );

    findings.push({
      packageName,
      importType: hasRuntimeSpecifier ? 'runtime' : 'type-only',
      file: filePath,
      line: lineOf(match.index),
      importStatement: match[0].trim(),
    });
  });

  return findings;
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

/**
 * Find all analyzable files in the directory
 */
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
