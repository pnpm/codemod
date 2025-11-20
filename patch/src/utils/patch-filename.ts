import { normalizePath } from "./path.ts";
import {
  PATCH_EXTENSION,
  PATCH_PACKAGE_SEPARATOR,
  PNPM_NAME_SEPARATOR,
  PNPM_VERSION_SEPARATOR,
} from "../constants.ts";

export function convertPatchFilename(oldName: string): string {
  const normalized = normalizePath(oldName);
  const pathParts = normalized.split('/');
  const filename = pathParts[pathParts.length - 1] || normalized;
  const nameWithoutExt = filename.endsWith(PATCH_EXTENSION) 
    ? filename.slice(0, -PATCH_EXTENSION.length) 
    : filename;
  const parts = nameWithoutExt.split(PATCH_PACKAGE_SEPARATOR);
  
  if (parts.length < 2) {
    throw new Error(`Invalid patch filename format: ${oldName}. Need at least name and version parts separated by '${PATCH_PACKAGE_SEPARATOR}'`);
  }
  
  const version = parts.pop();
  if (!version) {
    throw new Error(`Invalid patch filename format: ${oldName}. Missing version part`);
  }
  const name = parts.join(PNPM_NAME_SEPARATOR);
  return `${name}${PNPM_VERSION_SEPARATOR}${version}${PATCH_EXTENSION}`;
}

export function getPatchedDependencyKey(convertedFileName: string): string {
  const normalized = normalizePath(convertedFileName);
  const pathParts = normalized.split('/');
  const filename = pathParts[pathParts.length - 1] || normalized;
  const nameWithoutExt = filename.endsWith(PATCH_EXTENSION) 
    ? filename.slice(0, -PATCH_EXTENSION.length) 
    : filename;
  return nameWithoutExt.replace(new RegExp(PNPM_NAME_SEPARATOR, 'g'), '/');
}

