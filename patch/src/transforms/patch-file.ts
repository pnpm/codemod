
import type { SgRoot } from "codemod:ast-grep";
import type JSON from "codemod:ast-grep/langs/json";
import { writeFile, rm } from "fs/promises";
import { basename } from "path";
import { findWorkspaceRoot } from "../utils/path.ts";

function generateReplacePattern (patchFilePath: string): string {
  const baseName = basename(patchFilePath)
  const packageInfo = baseName.split('+').slice(0, -1).join('/')
  return `/node_modules/${packageInfo}`.replace(/\\/g, '/')
}

function convertPatchNameToPnpmFormat (patchFileName: string): string {
  const parts = patchFileName.split('+')
  const version = parts.pop()
  return `${parts.join('__')}@${version}`
}

const NODE_MODULES_PATTERNS = [
  'diff --git a/node_modules/',
  '--- a/node_modules/',
  '+++ b/node_modules/',
] as const
function needsConversion (content: string): boolean {
  return NODE_MODULES_PATTERNS.some(pattern => content.includes(pattern))
}

export async function transformPatchFile(root: SgRoot<JSON>): Promise<string | null> {
  const fileName = root.filename();
  const workspaceRoot = await findWorkspaceRoot(fileName);
  console.log(`Workspace root for patch file: ${workspaceRoot}`);
  const content = root.root().text();
  
  if (!needsConversion(content)) {
    return null; // Skip if no conversion needed
  }
  
  const replacePattern = generateReplacePattern(fileName)
	const convertedContent = content.replace(new RegExp(replacePattern, 'g'), '')
	const outputPath = convertPatchNameToPnpmFormat(fileName)
	
	await writeFile(outputPath, convertedContent, 'utf-8')
  await rm(fileName)

	return convertedContent
}

