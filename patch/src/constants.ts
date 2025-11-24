export const PATCH_EXTENSION = '.patch';
export const PACKAGE_JSON_FILE = 'package.json';
export const WORKSPACE_YAML_FILE = 'pnpm-workspace.yaml';
export const PATCHES_DIR_NAME = 'patches';
export const PATCH_PACKAGE_SEPARATOR = '+';
export const PNPM_NAME_SEPARATOR = '__';
export const PNPM_VERSION_SEPARATOR = '@';

// YAML parsing patterns
export const YAML_PATTERNS = {
  PATCHED_DEPS_SECTION: /patchedDependencies:\s*\n((?:\s+['"][^'"]+['"]:\s*['"][^'"]+['"]\n?)*)/,
  
  PATCHED_DEPS_ENTRY: /['"]([^'"]+)['"]:\s*['"]([^'"]+)['"]/g,
} as const;

// Patch filename validation
export const PATCH_FILENAME_PATTERNS = {
  isPnpmFormat: (filename: string): boolean => {
    return filename.includes(PNPM_VERSION_SEPARATOR) && !filename.includes(PATCH_PACKAGE_SEPARATOR);
  },
  
  isPatchPackageFormat: (filename: string): boolean => {
    return filename.includes(PATCH_PACKAGE_SEPARATOR);
  },
} as const;

export const ERROR_CODE_ENOENT = 'ENOENT';
export const ERROR_MESSAGE_NOT_FOUND = 'No such file or directory';