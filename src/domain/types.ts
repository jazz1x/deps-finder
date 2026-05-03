import { O } from '@mobily/ts-belt';

export type PackageName = string;
export type FilePath = string;
export type ImportStatement = string;

export const DEPENDENCY_TYPES = ['dependencies', 'devDependencies', 'peerDependencies'] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export type PackageJson = {
  readonly name: O.Option<string>;
  readonly version: O.Option<string>;
  readonly dependencies: O.Option<Record<PackageName, string>>;
  readonly devDependencies: O.Option<Record<PackageName, string>>;
  readonly peerDependencies: O.Option<Record<PackageName, string>>;
};

export type ImportType = 'runtime' | 'type-only';

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
  packageName: PackageName;
  importType: ImportType;
  file: string;
  line: number;
  importStatement: string;
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
  readonly checkAll: boolean;
  readonly checkPeer: boolean;
  readonly ignoredPackages: ReadonlyArray<string>;
  readonly excludePatterns: ReadonlyArray<string>;
  readonly noAutoDetect: boolean;
  readonly showHelp: boolean;
  readonly rootDir: string;
  readonly packageJsonPath: string;
  readonly warnings: ReadonlyArray<string>;
};
