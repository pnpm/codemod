import type { SgRoot } from "codemod:ast-grep";
import type JSON from "codemod:ast-grep/langs/json";
import { YAML_PATTERNS } from "../constants.ts";
import { normalizePath } from "../utils/path.ts";
import { findPatchesDirectory, scanForConvertedPatches } from "../scanners/patch-scanner.ts";

export async function transformWorkspaceYaml(root: SgRoot<JSON>): Promise<string | null> {
  const fileName = root.filename();
  const content = root.root().text();
  
  const patchesDir = await findPatchesDirectory(fileName);
  const convertedPatches = await scanForConvertedPatches(patchesDir);
  
  if (convertedPatches.size === 0) {
    return null;
  }
  
  const existingMatch = content.match(YAML_PATTERNS.PATCHED_DEPS_SECTION);
  const existingEntries = new Map<string, string>();
  
  if (existingMatch && existingMatch[1]) {
    const entriesText = existingMatch[1];
    YAML_PATTERNS.PATCHED_DEPS_ENTRY.lastIndex = 0;
    let match;
    while ((match = YAML_PATTERNS.PATCHED_DEPS_ENTRY.exec(entriesText)) !== null) {
      if (match[1] && match[2]) {
        existingEntries.set(match[1], match[2]);
      }
    }
  }
  
  for (const [key, patchPath] of convertedPatches.entries()) {
    const relativePatchPath = normalizePath(patchPath);
    existingEntries.set(key, relativePatchPath);
  }
  
  let newPatchedDepsSection = 'patchedDependencies:\n';
  if (existingEntries.size > 0) {
    const entries: string[] = [];
    for (const [key, path] of existingEntries.entries()) {
      entries.push(`  '${key}': '${path}'`);
    }
    newPatchedDepsSection += entries.join('\n') + '\n';
  }
  
  if (existingMatch) {
    const updatedContent = content.replace(YAML_PATTERNS.PATCHED_DEPS_SECTION, newPatchedDepsSection);
    return updatedContent === content ? null : updatedContent;
  }
  
  if (content.trim().length === 0) {
    return newPatchedDepsSection;
  }
  
  const trimmed = content.trimEnd();
  const needsNewline = !trimmed.endsWith('\n');
  return trimmed + (needsNewline ? '\n' : '') + newPatchedDepsSection;
}

