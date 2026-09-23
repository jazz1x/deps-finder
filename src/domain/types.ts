export type PackageName = string;

export const DEPENDENCY_TYPES = ['dependencies', 'devDependencies', 'peerDependencies'] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export type PackageJson = { readonly [K in DependencyType]: ReadonlyArray<PackageName> };

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
  readonly packageName: PackageName;
  readonly importType: ImportType;
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
