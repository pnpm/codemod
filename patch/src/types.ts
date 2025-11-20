export interface PatchedDependencies {
  [key: string]: string;
}

export interface PnpmConfig {
  patchedDependencies?: PatchedDependencies;
  [key: string]: unknown;
}

export interface PackageJson {
  name?: string;
  version?: string;
  pnpm?: PnpmConfig;
  [key: string]: unknown;
}

export interface PatchMetadata {
  originalFilename: string;
  convertedFilename: string;
  dependencyKey: string;
  relativePath: string;
}

export type PatchesMap = Map<string, string>;

export interface FileSystemError extends Error {
  code?: string;
  message: string;
}

export interface PatchValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
}

export interface PatchTransformResult {
  content: string;
  changed: boolean;
  validation: PatchValidationResult;
}

