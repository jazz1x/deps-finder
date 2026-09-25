import path from 'node:path';
import type { JSXElementName, Program } from '@oxc-project/types';
import { Array, Data, Match, Option, Order, Record, Result, pipe } from 'effect';
import type { ParseResult, StaticImport } from 'oxc-parser';
import { TYPESCRIPT_EXTENSIONS } from '../constants/patterns.js';
import type { FileError } from '../domain/errors.js';
import {
  type ImportDetails,
  JsxRuntime,
  type PackageJson,
  type SourceFile,
  installedOnlyForDevelopment,
} from '../domain/types.js';
import { readFile } from '../utils/file-reader.js';
import { buildLineStarts, lineNumberAt } from '../utils/line-index.js';
import { collectVisiting, fileJsxRuntimes, parse } from './import-parser.js';

type AstEvent = Data.TaggedEnum<{
  TypeSpan: { readonly start: number; readonly end: number };
  NotReference: { readonly at: number };
  Name: { readonly name: string; readonly at: number };
}>;

const AstEvent = Data.taggedEnum<AstEvent>();

type Spanned = { readonly start: number; readonly end: number };

const typeSpan = (node: Spanned): ReadonlyArray<AstEvent> => [
  AstEvent.TypeSpan({ start: node.start, end: node.end }),
];

const notReference = (name: Spanned | null): ReadonlyArray<AstEvent> =>
  Array.map(Option.toArray(Option.fromNullOr(name)), ({ start }) =>
    AstEvent.NotReference({ at: start }),
  );

const memberKey = (member: {
  readonly computed: boolean;
  readonly key: Spanned;
}): ReadonlyArray<AstEvent> => (member.computed ? [] : notReference(member.key));

const jsxRoot = (
  name: JSXElementName,
): Option.Option<{ readonly name: string; readonly start: number }> =>
  Match.value(name).pipe(
    Match.when({ type: 'JSXIdentifier' }, (identifier) => Option.some(identifier)),
    Match.when({ type: 'JSXMemberExpression' }, (member) => jsxRoot(member.object)),
    Match.orElse(() => Option.none()),
  );

// A classic JSX element calls its factory, React.createElement unless configured otherwise.
const factoryUse = (factories: ReadonlyArray<string>, at: number): ReadonlyArray<AstEvent> =>
  Array.map(factories, (name) => AstEvent.Name({ name, at }));

// Type spans come from a tree walk, so they nest or are disjoint. Merged into sorted disjoint
// intervals they answer "inside a type?" by binary search: a 34k-line codegen file took 1.9s
// when every name was checked against every span.
const coveredBy = (spans: ReadonlyArray<Spanned>): ((at: number) => boolean) => {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const span of Array.sort(spans, bySpanStart)) {
    const last = ends.length - 1;
    if (last >= 0 && span.start < (ends[last] as number)) {
      ends[last] = Math.max(ends[last] as number, span.end);
    } else {
      starts.push(span.start);
      ends.push(span.end);
    }
  }
  return (at) => {
    const index = lineNumberAt(starts, at) - 1;
    return index >= 0 && at < (ends[index] as number);
  };
};

const bySpanStart = Order.mapInput(Order.Number, (span: Spanned) => span.start);

// The bound names used anywhere outside a type position, an import or export of types, a
// property, member or enum key, or a label. Scopes are not tracked: a parameter or local that
// reuses an imported name still counts as a use, which keeps the import.
const valueUses = (
  program: Program,
  bound: ReadonlyArray<string>,
  factories: ReadonlyArray<string>,
): ReadonlySet<string> => {
  const boundNames: ReadonlySet<string> = new Set(bound);
  const events = collectVisiting<AstEvent>(program, (collect) => ({
    ImportDeclaration: (node) => collect(typeSpan(node)),
    TSTypeReference: (node) => collect(typeSpan(node)),
    TSTypeQuery: (node) => collect(typeSpan(node)),
    TSInterfaceDeclaration: (node) => collect(typeSpan(node)),
    TSClassImplements: (node) => collect(typeSpan(node)),
    TSTypeLiteral: (node) => collect(typeSpan(node)),
    TSTypeParameter: (node) => collect(typeSpan(node)),
    TSEnumMember: (node) => collect(memberKey({ computed: node.computed, key: node.id })),
    PropertyDefinition: (node) => collect(memberKey(node)),
    MethodDefinition: (node) => collect(memberKey(node)),
    LabeledStatement: (node) => collect(notReference(node.label)),
    BreakStatement: (node) => collect(notReference(node.label)),
    ContinueStatement: (node) => collect(notReference(node.label)),
    ExportNamedDeclaration: (node) => collect(node.exportKind === 'type' ? typeSpan(node) : []),
    ExportSpecifier: (node) => collect(node.exportKind === 'type' ? typeSpan(node) : []),
    MemberExpression: (node) =>
      collect(node.computed ? [] : [AstEvent.NotReference({ at: node.property.start })]),
    Property: (node) => collect(node.shorthand ? [] : memberKey(node)),
    Identifier: (node) =>
      collect(
        boundNames.has(node.name) ? [AstEvent.Name({ name: node.name, at: node.start })] : [],
      ),
    JSXOpeningElement: (node) =>
      collect([
        ...Option.toArray(
          Option.map(jsxRoot(node.name), (root) =>
            AstEvent.Name({ name: root.name, at: root.start }),
          ),
        ),
        ...factoryUse(factories, node.start),
      ]),
    JSXFragment: (node) => collect(factoryUse(factories, node.start)),
  }));
  const insideType = coveredBy(Array.filter(events, AstEvent.$is('TypeSpan')));
  const detached = new Set(
    Array.map(Array.filter(events, AstEvent.$is('NotReference')), ({ at }) => at),
  );
  return new Set(
    pipe(
      events,
      Array.filter(AstEvent.$is('Name')),
      Array.filter(({ at }) => !detached.has(at) && !insideType(at)),
      Array.map(({ name }) => name),
    ),
  );
};

const keptFactories = (
  content: string,
  parsed: ParseResult,
  configured: Array.NonEmptyReadonlyArray<JsxRuntime>,
): ReadonlyArray<string> =>
  Array.flatMap(
    fileJsxRuntimes(content, parsed, configured),
    JsxRuntime.$match({
      Automatic: (): ReadonlyArray<string> => [],
      Classic: ({ factory }) => [factory],
      Preserved: ({ factory }) => [factory],
    }),
  );

const valueEntries = (statement: StaticImport) =>
  Array.filter(statement.entries, (entry) => !entry.isType);

// Other loads of the same package can share an import's line.
const statementKey = (line: number, statement: string): string => `${line}:${statement}`;

// The import statements TypeScript erases: every binding is used only as a type, or not at all.
const erasedStatements = (content: string, source: SourceFile): ReadonlySet<string> => {
  const parsed = parse(content, source.path);
  const withValues = Array.filter(parsed.module.staticImports, (statement) =>
    Array.isReadonlyArrayNonEmpty(valueEntries(statement)),
  );
  const used = valueUses(
    parsed.program,
    Array.flatMap(withValues, (statement) =>
      Array.map(valueEntries(statement), (entry) => entry.localName.value),
    ),
    keptFactories(content, parsed, source.emit.jsx),
  );
  const lineStarts = buildLineStarts(content);
  return new Set(
    pipe(
      withValues,
      Array.filter(
        (statement) =>
          !Array.some(valueEntries(statement), (entry) => used.has(entry.localName.value)),
      ),
      Array.map((statement) =>
        statementKey(
          lineNumberAt(lineStarts, statement.start),
          content.slice(statement.start, statement.end).trim(),
        ),
      ),
    ),
  );
};

// Only would-be misplaced imports are re-read. A dependency whose value import is used only as a
// type is often a runtime peer of another package (graphql for @apollo/client), so elision must
// not move it to typeOnly: on real projects that turned into "move to devDependencies" advice.
type Candidate = {
  readonly detail: ImportDetails;
  readonly source: SourceFile;
};

const isElidedByCompiler = (source: SourceFile): boolean =>
  Array.contains(TYPESCRIPT_EXTENSIONS, path.extname(source.path)) &&
  Match.value(source.emit.elision).pipe(
    Match.when('unused-bindings', () => true),
    Match.whenOr('verbatim', 'decorator-metadata', () => false),
    Match.exhaustive,
  );

const candidatesByFile = (
  packageJson: PackageJson,
  imports: ReadonlyArray<ImportDetails>,
  sources: ReadonlyArray<SourceFile>,
): ReadonlyArray<Array.NonEmptyReadonlyArray<Candidate>> => {
  const elidable = new Map(
    Array.map(
      Array.filter(sources, isElidedByCompiler),
      (source) => [source.path, source] as const,
    ),
  );
  const misplacedCandidate = installedOnlyForDevelopment(packageJson);
  return pipe(
    imports,
    Array.filter(
      (detail) =>
        detail.context === 'production' &&
        detail.importType === 'runtime' &&
        misplacedCandidate(detail.packageName),
    ),
    Array.flatMap((detail) =>
      pipe(
        Option.fromUndefinedOr(elidable.get(detail.file)),
        Option.map((source): Candidate => ({ detail, source })),
        Option.toArray,
      ),
    ),
    Array.groupBy((candidate) => candidate.detail.file),
    Record.toEntries,
    (entries) =>
      Array.sort(
        entries,
        Order.mapInput(Order.String, ([file]: readonly [string, unknown]) => file),
      ),
    Array.map(([, candidates]) => candidates),
  );
};

type Refining = {
  readonly erased: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<FileError>;
};

const detailKey = (detail: ImportDetails): string =>
  `${detail.file}:${statementKey(detail.line, detail.importStatement)}`;

const refineFile = (
  state: Refining,
  candidates: Array.NonEmptyReadonlyArray<Candidate>,
): Refining =>
  pipe(Array.headNonEmpty(candidates), ({ source }) =>
    Result.match(readFile(source.path), {
      onFailure: (error) => ({ ...state, skipped: [...state.skipped, error] }),
      onSuccess: (content) => {
        const erased = erasedStatements(content, source);
        return {
          erased: [
            ...state.erased,
            ...pipe(
              candidates,
              Array.filter((candidate) =>
                erased.has(statementKey(candidate.detail.line, candidate.detail.importStatement)),
              ),
              Array.map((candidate) => detailKey(candidate.detail)),
            ),
          ],
          skipped: state.skipped,
        };
      },
    }),
  );

// TypeScript erases an import whose bindings are used only as types. Only the imports that would
// make a package misplaced are re-read, file by file.
export const elideTypeOnlyImports = (
  packageJson: PackageJson,
  imports: ReadonlyArray<ImportDetails>,
  sources: ReadonlyArray<SourceFile>,
): {
  readonly imports: ReadonlyArray<ImportDetails>;
  readonly skipped: ReadonlyArray<FileError>;
} => {
  const refined = Array.reduce(
    candidatesByFile(packageJson, imports, sources),
    { erased: [], skipped: [] } as Refining,
    refineFile,
  );
  const erased = new Set(refined.erased);
  return {
    imports: Array.map(imports, (detail) =>
      erased.has(detailKey(detail)) ? { ...detail, importType: 'type-only' } : detail,
    ),
    skipped: refined.skipped,
  };
};
