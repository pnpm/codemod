import { readdir, stat } from "fs/promises";
import { dirname, join } from "path";
import { PATCH_EXTENSION, PATCHES_DIR_NAME, PATCH_FILENAME_PATTERNS } from "../constants.ts";
import type { PatchesMap } from "../types.ts";
import { normalizePath } from "../utils/path.ts";
import { findWorkspaceRoot } from "../utils/path.ts";
import { convertPatchFilename, getPatchedDependencyKey } from "../utils/patch-filename.ts";
import { isNotFoundError } from "../utils/errors.ts";

export async function scanForConvertedPatches(patchesDir: string): Promise<PatchesMap> {
  const patches = new Map<string, string>();
  
  try {
    const stats = await stat(patchesDir);
    if (!stats.isDirectory()) {
      return patches;
    }
    
    const files = await readdir(patchesDir);
    const dirName = normalizePath(patchesDir.split(/[/\\]/).pop() || PATCHES_DIR_NAME);
    
    for (const file of files) {
      const normalizedFile = normalizePath(file);
      
      if (!normalizedFile.endsWith(PATCH_EXTENSION)) {
        continue;
      }
      
      let pnpmFormatFileName: string;
      let key: string;
      
      // Check if it's already in pnpm format (contains '@' and doesn't contain '+')
      if (PATCH_FILENAME_PATTERNS.isPnpmFormat(normalizedFile)) {
        // Already converted to pnpm format
        pnpmFormatFileName = normalizedFile;
        key = getPatchedDependencyKey(normalizedFile);
      } 
      // Check if it's in patch-package format (contains '+')
      else if (PATCH_FILENAME_PATTERNS.isPatchPackageFormat(normalizedFile)) {
        // Convert patch-package format to pnpm format on-the-fly
        try {
          pnpmFormatFileName = convertPatchFilename(normalizedFile);
          key = getPatchedDependencyKey(pnpmFormatFileName);
        } catch (error) {
          // Skip invalid patch filenames
          console.warn(`Skipping invalid patch filename: ${normalizedFile}`, error);
          continue;
        }
      } else {
        // Skip files that don't match either format
        continue;
      }
      
      // Get relative path: directory name + filename (e.g., "patches/@scope__pkg@1.2.3.patch")
      const relativePath = normalizePath(join(dirName, pnpmFormatFileName));
      patches.set(key, relativePath);
    }
  } catch (error: unknown) {
    // If directory doesn't exist or can't be read, return empty map
    // This is expected when packages don't have patches, so we don't log warnings
    // Silently return empty map for "not found" errors - this is expected
    if (!isNotFoundError(error)) {
      console.warn(`Could not scan patches directory ${patchesDir}:`, error);
    }
  }
  
  return patches;
}

export async function findPatchesDirectory(configFilePath: string): Promise<string> {
  const configDir = normalizePath(dirname(configFilePath));
  
  // First, try to find workspace root (in case this is a workspace setup)
  const workspaceRoot = await findWorkspaceRoot(configFilePath);
  
  // Common locations: ./patches relative to config, ../patches, and workspace root/patches
  const candidates = [
    normalizePath(join(configDir, PATCHES_DIR_NAME)),
    normalizePath(join(configDir, '..', PATCHES_DIR_NAME)),
    normalizePath(join(workspaceRoot, PATCHES_DIR_NAME)),
  ];
  
  // Remove duplicates
  const uniqueCandidates = Array.from(new Set(candidates));
  
  for (const candidate of uniqueCandidates) {
    try {
      const stats = await stat(candidate);
      if (stats.isDirectory()) {
        return candidate;
      }
    } catch {
      // Directory doesn't exist, try next candidate
    }
  }
  
  // Default to ./patches relative to config file if not found
  return normalizePath(join(configDir, PATCHES_DIR_NAME));
}

