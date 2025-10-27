import fs from 'fs'
import path from 'path'
import type { Api } from "@codemod.com/workflow";

async function validateAndGetPatchFiles (folderPath: string): Promise<string[]> {
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Folder not found: ${folderPath}`)
  }

  const stat = await fs.promises.stat(folderPath)
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${folderPath}`)
  }

  const files = await fs.promises.readdir(folderPath)
  const patchFiles = files.filter((file: string) => file.endsWith('.patch'))

  if (patchFiles.length === 0) {
    throw new Error(`No patch files found in directory: ${folderPath}`)
  }

  return patchFiles.map((file: string) => path.join(folderPath, file))
}

const NODE_MODULES_PATTERNS = [
  'diff --git a/node_modules/',
  '--- a/node_modules/',
  '+++ b/node_modules/',
] as const

function needsConversion (content: string): boolean {
  return NODE_MODULES_PATTERNS.some(pattern => content.includes(pattern))
}

function generateReplacePattern (patchFilePath: string): string {
  const baseName = path.basename(patchFilePath)
  const packageInfo = baseName.split('+').slice(0, -1).join('/')
  return `/node_modules/${packageInfo}`.replace(/\\/g, '/')
}

async function convertContentAndFileName (patchFilePath: string): Promise<string> {
  const patchContent = await fs.promises.readFile(patchFilePath, 'utf8')

  if (!needsConversion(patchContent)) {
    return ''
  }

  const replacePattern = generateReplacePattern(patchFilePath)
  const convertedContent = patchContent.replace(new RegExp(replacePattern, 'g'), '')
  const outputPath = convertPatchNameToPnpmFormat(patchFilePath)

  await fs.promises.writeFile(outputPath, convertedContent, 'utf8')
  await fs.promises.unlink(patchFilePath)
  return outputPath
}

function convertPatchNameToPnpmFormat (patchFileName: string): string {
  const parts = patchFileName.split('+')
  const version = parts.pop()
  return `${parts.join('__')}@${version}`
}

function convertedPathToPatchedDependencyKeyValue (convertedPath: string): [string, string] {
  const baseName = path.basename(convertedPath)
  const normalizedPath = convertedPath.replace(/\\/g, '/')
  const patchesDir = path.dirname(normalizedPath).split('/').pop()!
  const key = baseName.replace(/\.patch$/, '').replace(/__/g, '/')
  return [key, `${patchesDir}/${baseName}`]
}

function validatePatchFile (patchFilePath: string): void {
  if (!fs.existsSync(patchFilePath)) {
    throw new Error(`Patch file not found: ${patchFilePath}`)
  }
  if (!patchFilePath.endsWith('.patch')) {
    throw new Error(`File must have .patch extension: ${patchFilePath}`)
  }
  if (!patchFilePath.includes('+')) {
    throw new Error(`Invalid patch file name: expected '+' in the file name (e.g. pkg+1.0.0.patch): ${patchFilePath}`)
  }
}

function checkOutputExists (patchFilePath: string): void {
  const convertedName = convertPatchNameToPnpmFormat(path.basename(patchFilePath))
  const outputPath = path.join(path.dirname(patchFilePath), convertedName)
  if (fs.existsSync(outputPath)) {
    throw new Error(`Converted patch file already exists: ${convertedName}`)
  }
}

async function convertSinglePatchFile (patchFilePath: string): Promise<Array<[string, string]>> {
  validatePatchFile(patchFilePath)
  checkOutputExists(patchFilePath)

  const convertedPath = await convertContentAndFileName(patchFilePath)
  return convertedPath ? [convertedPathToPatchedDependencyKeyValue(convertedPath)] : []
}

async function convertPatchFile (patchPath: string): Promise<Array<[string, string]>> {
  if (!fs.existsSync(patchPath)) {
    throw new Error(`Path not found: ${patchPath}`)
  }

  const stat = await fs.promises.stat(patchPath)

  if (stat.isDirectory()) {
    const patchFiles = await validateAndGetPatchFiles(patchPath)
    const convertedPaths = await Promise.all(patchFiles.map(convertContentAndFileName))
    return convertedPaths.filter(Boolean).map(convertedPathToPatchedDependencyKeyValue)
  } else {
    return convertSinglePatchFile(patchPath)
  }
}

export async function workflow({ files, dirs, exec, options }: Api & { options: { patchPath?: string } }) {
	let updateConfigFile = 'pnpm-workspace.yaml'
  const workspaceFile = files("pnpm-workspace.yaml").yaml();
	let workspaceConfig = (
		await workspaceFile.map(({ getContents }) =>
			getContents<{ patchedDependencies: Record<string, string> }>(),
		)
	).pop();

	if (!workspaceConfig) {
		const packageJsonFiles = files('package.json').json();
		workspaceConfig = ((
			await packageJsonFiles.map(({ getContents }) => getContents<{ pnpm: { patchedDependencies: Record<string, string> } }>())
		).pop())?.pnpm ?? { patchedDependencies: {} };
		updateConfigFile = 'package.json'
	}
	
	const _patchPath = options.patchPath ?? './patches'
	const basePath = process.cwd()
	const patchesPath = path.join(basePath, _patchPath).replace(/\\/g, '/')
  const convertedFiles = await convertPatchFile(patchesPath)

  if (convertedFiles.length === 0) {
    return
  }

  const patchedDependencies = { ...workspaceConfig.patchedDependencies }
  for (const [key, value] of convertedFiles) {
    patchedDependencies[key] = value
  }

	if (updateConfigFile === 'package.json') {
		const packageJsonFile = files('package.json').json();
		await packageJsonFile.update<{ pnpm: { patchedDependencies: Record<string, string> } }>(
			({ pnpm, ...rest }) => ({
				...rest,
				pnpm: {
					...pnpm,
					patchedDependencies: {
						...pnpm.patchedDependencies,
						...patchedDependencies,
					},
				},
			}),
		);
	} else {
		await workspaceFile.update<{ patchedDependencies: Record<string, string> }>(
			({ patchedDependencies, ...rest }) => ({
				...rest,
				patchedDependencies: {
					...patchedDependencies,
				},
			}),
		);
	}

	await exec("pnpm", ["install"]);

	console.log(`Converted patch files and updated ${updateConfigFile} with patched dependencies.`);
}