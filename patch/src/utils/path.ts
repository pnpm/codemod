import { dirname, join, normalize } from "path";
import { access, readFile } from "fs/promises";
import { WORKSPACE_YAML_FILE, PACKAGE_JSON_FILE } from "../constants.ts";
import type { PackageJson } from "../types.ts";

export function normalizePath(path: string): string {
  return normalize(path).replace(/\\/g, '/');
}

export async function findWorkspaceRoot(filePath: string): Promise<string> {
  let currentDir = normalizePath(dirname(filePath));
  const root = normalizePath('/');
  let lastPackageJsonDir = currentDir;
  
  while (currentDir !== root && currentDir !== '') {
    try {
      const workspaceYamlPath = normalizePath(join(currentDir, WORKSPACE_YAML_FILE));
      await access(workspaceYamlPath);
      return currentDir;
    } catch {}
    
    try {
      const packageJsonPath = normalizePath(join(currentDir, PACKAGE_JSON_FILE));
      await access(packageJsonPath);
      lastPackageJsonDir = currentDir;
    } catch {}
    
    // Move up one directory
    const parentDir = normalizePath(dirname(currentDir));
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }
  
  return lastPackageJsonDir;
}

export async function findPatchesDirectory(root: string) {
  console.log('Finding patches directory in workspace root:', process.cwd());
  const packageJsonPath = normalizePath(join(root, PACKAGE_JSON_FILE));
  const content = await readFile(packageJsonPath, "utf-8");
  const packageJson = JSON.parse(content) as PackageJson;
  let patchesDir = 'patches';
  if (packageJson.pnpm?.patchesDir) {
    patchesDir = packageJson.pnpm.patchesDir as string;
  } else {
    const workspaceYamlPath = normalizePath(join(root, WORKSPACE_YAML_FILE));
    try {
      const workspaceContent = await readFile(workspaceYamlPath, "utf-8");
      const match = workspaceContent.match(/patchesDir:\s*(\S+)/);
      if (match?.[1]) {
        patchesDir = match[1];
      }
    } catch (err) {
      // If the workspace YAML file does not exist or is unreadable, ignore and use default patchesDir
    }
  }
  return patchesDir;
}

