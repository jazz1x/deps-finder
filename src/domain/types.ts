import { type Array, Data } from 'effect';
import type { FileError } from './errors.js';

export type PackageName = string;

export type Gathered<A> = {
  readonly found: ReadonlyArray<A>;
  readonly skipped: ReadonlyArray<FileError>;
};

export const DEPENDENCY_TYPES = ['dependencies', 'devDependencies', 'peerDependencies'] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

// A package that publishes declarations exposes its dependencies' types to its consumers.
export type PackageJson = { readonly [K in DependencyType]: ReadonlyArray<PackageName> } & {
  readonly declarations: 'published' | 'none';
};

// peer: installed for a used package that names it in peerDependencies.
export type ImportType = 'runtime' | 'type-only' | 'peer';

export type FileContext = 'production' | 'development';

// Preserved: tsc leaves JSX to the next compiler, counted as react/jsx-runtime, and keeps the
// factory import as under the classic runtime.
export type JsxRuntime = Data.TaggedEnum<{
  Classic: { readonly factory: string };
  Automatic: { readonly importSource: string };
  Preserved: { readonly factory: string };
}>;

export const JsxRuntime = Data.taggedEnum<JsxRuntime>();

// unused-bindings: an import none of whose bindings is used as a value is erased.
// verbatim: an import is erased only when written `import type`.
// decorator-metadata: emitted metadata can name a type-position binding, so none is known erased.
export type ImportElision = 'unused-bindings' | 'verbatim' | 'decorator-metadata';

// How the compiler emits a file, from the tsconfig that governs it.
export type EmitSettings = {
  readonly jsx: Array.NonEmptyReadonlyArray<JsxRuntime>;
  readonly elision: ImportElision;
};

export type SourceFile = {
  readonly path: string;
  readonly context: FileContext;
  readonly emit: EmitSettings;
};

export type ImportLocation = {
  readonly file: string;
  readonly line: number;
  readonly importStatement: string;
};

export type DependencyUsage = {
  readonly packageName: PackageName;
  readonly locations: ReadonlyArray<ImportLocation>;
};

export type ImportDetails = {
  readonly packageName: PackageName;
  readonly importType: ImportType;
  readonly context: FileContext;
  readonly file: string;
  readonly line: number;
  readonly importStatement: string;
};

// A package a script or a tool config uses without an import.
export const developmentUse = (
  packageName: PackageName,
  file: string,
  importStatement: string,
): ImportDetails => ({
  packageName,
  importType: 'runtime',
  context: 'development',
  file,
  line: 1,
  importStatement,
});

// A command line to run, and the scripts of the package.json it runs against.
export type ScriptCommand = {
  readonly file: string;
  readonly script: string;
  readonly scripts: ReadonlyArray<string>;
};

export type InstalledPackage = {
  readonly manifest: string;
  readonly bins: ReadonlyArray<string>;
  readonly peers: ReadonlyArray<PackageName>;
};

export type Installation = Data.TaggedEnum<{
  Installed: { readonly packages: Readonly<Record<PackageName, InstalledPackage>> };
  NotInstalled: {};
}>;

export const Installation = Data.taggedEnum<Installation>();

export type AnalysisResult = {
  readonly unused: ReadonlyArray<PackageName>;
  readonly unusedPeer: ReadonlyArray<PackageName>;
  readonly misplaced: ReadonlyArray<DependencyUsage>;
  readonly typeOnly: ReadonlyArray<PackageName>;
  readonly totalIssues: number;
};

export const OUTPUT_FORMATS = ['text', 'json'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export type CliOptions = {
  readonly format: OutputFormat;
  readonly sections: ReadonlyArray<DependencyType>;
  readonly ignoredPackages: ReadonlyArray<string>;
  readonly excludePatterns: ReadonlyArray<string>;
  readonly noAutoDetect: boolean;
  readonly rootDir: string;
};
