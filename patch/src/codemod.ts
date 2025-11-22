import type { Transform, SgRoot, SgNode } from "codemod:ast-grep";
import type JSON from "codemod:ast-grep/langs/json";
import type YAML from "codemod:ast-grep/langs/yaml";
import { access } from "fs/promises";
import { dirname, join } from "path";
import {
  PATCH_EXTENSION,
  PACKAGE_JSON_FILE,
  WORKSPACE_YAML_FILE,
} from "./constants.ts";
import { normalizePath, findWorkspaceRoot } from "./utils/path.ts";
import { transformPatchFile } from "./transforms/patch-file.ts";
import { transformPackageJson } from "./transforms/package-json.ts";
import { transformWorkspaceYaml } from "./transforms/workspace-yaml.ts";

const transform: Transform<JSON | YAML> = async (root: SgRoot<JSON | YAML>): Promise<string | null> => {
  const fileName = normalizePath(root.filename());
  
  if (fileName.endsWith(PATCH_EXTENSION)) {
    return await transformPatchFile(root as SgRoot<JSON>);
  }
  
  if (fileName.endsWith(PACKAGE_JSON_FILE)) {
    const workspaceRoot = await findWorkspaceRoot(fileName);
    
    try {
      const workspaceYamlPath = normalizePath(join(workspaceRoot, WORKSPACE_YAML_FILE));
      await access(workspaceYamlPath);
      return null;
    } catch {
    }
    
    const packageJsonDir = normalizePath(dirname(fileName));
    const isRoot = packageJsonDir === workspaceRoot;
    if (!isRoot) {
      return null;
    }
    
    return await transformPackageJson(root.root() as SgNode<JSON>, root as SgRoot<JSON>);
  }
  
  if (fileName.endsWith(WORKSPACE_YAML_FILE)) {
    return await transformWorkspaceYaml(root as SgRoot<YAML>);
  }
  
  return null;
};

export default transform;
