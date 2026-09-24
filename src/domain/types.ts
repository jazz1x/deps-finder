import { Data } from 'effect';
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

export type ImportType = 'runtime' | 'type-only';

export type FileContext = 'production' | 'development';

export type JsxRuntime = Data.TaggedEnum<{
  Classic: {};
  Automatic: { readonly importSource: string };
}>;

export const JsxRuntime = Data.taggedEnum<JsxRuntime>();

// verbatim: an import is erased only when written `import type`.
export type ImportElision = 'unused-bindings' | 'verbatim';

// How the compiler emits a file, from the tsconfig that governs it.
export type EmitSettings = { readonly jsx: JsxRuntime; readonly elision: ImportElision };

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
