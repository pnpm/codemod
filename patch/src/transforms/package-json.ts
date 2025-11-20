import type { SgNode, SgRoot } from "codemod:ast-grep";
import type JSON from "codemod:ast-grep/langs/json";
import { normalizePath } from "../utils/path.ts";
import { findPatchesDirectory, scanForConvertedPatches } from "../scanners/patch-scanner.ts";

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

export async function transformPackageJson(
  rootNode: SgNode<JSON>,
  root: SgRoot<JSON>
): Promise<string | null> {
  const fileName = root.filename();
  const content = root.root().text();
  
  const patchesDir = await findPatchesDirectory(fileName);
  const convertedPatches = await scanForConvertedPatches(patchesDir);
  
  if (convertedPatches.size === 0) {
    return null;
  }
  
  let packageJson: PackageJson;
  try {
    packageJson = JSON.parse(content) as PackageJson;
  } catch (error) {
    console.error(`Failed to parse package.json:`, error);
    return null;
  }
  
  if (!packageJson.pnpm) {
		return null;
  }
  if (!packageJson.pnpm.patchedDependencies) {
    packageJson.pnpm.patchedDependencies = {};
  }
  
  const existingDeps = packageJson.pnpm.patchedDependencies;
  for (const [key, patchPath] of convertedPatches.entries()) {
    const relativePatchPath = normalizePath(patchPath);
    existingDeps[key] = relativePatchPath;
  }
  
  const updatedContent = JSON.stringify(packageJson, null, 2) + '\n';
  
  if (updatedContent === content) {
    return null;
  }
  
  return updatedContent;
}

