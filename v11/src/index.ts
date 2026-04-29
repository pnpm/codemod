import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { globSync } from "glob";
import * as semver from "semver";
import * as YAML from "yaml";
import {
	type DevEnginesRuntime,
	type MigrationWarning,
	type PnpmSettings,
	applyMigrations,
} from "./migrations.js";
import { parseNpmrc, serializeNpmrc } from "./npmrc.js";
import { hasOwn, isSafeKey } from "./safe-keys.js";

const PNPM_V11_VERSION = "11.0.1";

type PackageJson = {
	name?: string;
	packageManager?: string;
	pnpm?: PnpmSettings;
	devEngines?: { runtime?: DevEnginesRuntime; [key: string]: unknown };
	[key: string]: unknown;
};

type SubprojectNpmrc = {
	name: string;
	npmrcPath: string;
	originalContent: string;
	linesToKeep: string[];
	migratedSettings: PnpmSettings;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

// Copy user-controlled entries into `dst` while dropping prototype-polluting
// keys and preserving any key that is already an own property of `dst`.
const mergeSettings = (
	dst: Record<string, unknown>,
	src: Record<string, unknown>,
): void => {
	for (const [key, value] of Object.entries(src)) {
		if (!isSafeKey(key)) continue;
		if (hasOwn(dst, key)) continue;
		dst[key] = value;
	}
};

const readJson = <T>(path: string): T | null => {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
};

const writeJson = (path: string, value: unknown): void => {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const readYaml = <T>(path: string): T | null => {
	try {
		const parsed = YAML.parse(readFileSync(path, "utf8"));
		return (parsed ?? null) as T | null;
	} catch {
		return null;
	}
};

const bumpPackageManager = (packageManager: string): string | null => {
	const match = /^pnpm@(.+)$/.exec(packageManager);
	if (!match) return null;
	const current = match[1] as string;
	const coerced = semver.coerce(current);
	if (!coerced) return null;
	if (semver.gte(coerced, "11.0.0")) return null;
	return `pnpm@${PNPM_V11_VERSION}`;
};

// Returns true if the `.npmrc` file was actually changed on disk.
const writeOrDeleteNpmrc = (
	npmrcPath: string,
	originalContent: string,
	linesToKeep: string[],
): boolean => {
	const serialized = serializeNpmrc(linesToKeep);
	if (serialized === null) {
		if (!existsSync(npmrcPath)) return false;
		rmSync(npmrcPath, { force: true });
		return true;
	}
	if (serialized === originalContent) return false;
	writeFileSync(npmrcPath, serialized);
	return true;
};

const collectSubprojectNpmrc = (
	cwd: string,
	workspacePackages: string[],
): SubprojectNpmrc[] => {
	const results: SubprojectNpmrc[] = [];

	const includes = workspacePackages.filter((p) => !p.startsWith("!"));
	const excludes = workspacePackages
		.filter((p) => p.startsWith("!"))
		.map((p) => p.slice(1));

	const matchedDirs = globSync(includes, {
		cwd,
		ignore: ["**/node_modules/**", ...excludes],
		absolute: true,
	});

	for (const dir of matchedDirs) {
		const npmrcPath = join(dir, ".npmrc");
		const packageJsonPath = join(dir, "package.json");
		if (!existsSync(npmrcPath) || !existsSync(packageJsonPath)) continue;

		const pkg = readJson<PackageJson>(packageJsonPath);
		const packageName = pkg?.name;
		if (!packageName) continue;

		const originalContent = readFileSync(npmrcPath, "utf8");
		const { linesToKeep, migratedSettings } = parseNpmrc(originalContent);
		if (Object.keys(migratedSettings).length === 0) continue;

		results.push({
			name: packageName,
			npmrcPath,
			originalContent,
			linesToKeep,
			migratedSettings,
		});
	}

	return results;
};

export type MigrationRun = {
	warnings: MigrationWarning[];
	mutatedWorkspaceYaml: boolean;
	mutatedPackageJson: boolean;
	mutatedRootNpmrc: boolean;
	mutatedSubprojectNpmrcs: number;
};

export const runMigration = (cwd: string = process.cwd()): MigrationRun => {
	const packageJsonPath = resolve(cwd, "package.json");
	const workspaceYamlPath = resolve(cwd, "pnpm-workspace.yaml");
	const npmrcPath = resolve(cwd, ".npmrc");

	const rootPackageJson = readJson<PackageJson>(packageJsonPath);
	if (!rootPackageJson) {
		console.log("package.json not found. Nothing to migrate.");
		return {
			warnings: [],
			mutatedWorkspaceYaml: false,
			mutatedPackageJson: false,
			mutatedRootNpmrc: false,
			mutatedSubprojectNpmrcs: 0,
		};
	}

	const pnpmSettingsFromPackageJson: PnpmSettings = isPlainObject(
		rootPackageJson.pnpm,
	)
		? { ...(rootPackageJson.pnpm as PnpmSettings) }
		: {};
	const hasPnpmSettingsInPackageJson =
		Object.keys(pnpmSettingsFromPackageJson).length > 0;

	const workspaceYamlExists = existsSync(workspaceYamlPath);
	const existingWorkspaceYaml = workspaceYamlExists
		? readYaml<Record<string, unknown>>(workspaceYamlPath) ?? {}
		: {};
	const workspacePackages = Array.isArray(existingWorkspaceYaml.packages)
		? (existingWorkspaceYaml.packages as string[])
		: [];

	const rootNpmrcContent = existsSync(npmrcPath)
		? readFileSync(npmrcPath, "utf8")
		: null;
	const rootNpmrc =
		rootNpmrcContent !== null ? parseNpmrc(rootNpmrcContent) : null;

	const subprojectNpmrcs = collectSubprojectNpmrc(cwd, workspacePackages);

	const collectedWarnings: MigrationWarning[] = [];
	let devEnginesRuntime: DevEnginesRuntime | undefined;
	let mutatedWorkspaceYaml = false;

	const needsWorkspaceYaml =
		workspaceYamlExists ||
		hasPnpmSettingsInPackageJson ||
		(rootNpmrc && Object.keys(rootNpmrc.migratedSettings).length > 0) ||
		subprojectNpmrcs.length > 0;

	if (needsWorkspaceYaml) {
		const next: Record<string, unknown> = { ...existingWorkspaceYaml };

		mergeSettings(next, pnpmSettingsFromPackageJson);

		if (rootNpmrc) {
			mergeSettings(next, rootNpmrc.migratedSettings);
		}

		if (subprojectNpmrcs.length > 0) {
			const existingPackageConfigs = isPlainObject(next.packageConfigs)
				? (next.packageConfigs as Record<string, unknown>)
				: {};
			const packageConfigs: Record<string, unknown> = {
				...existingPackageConfigs,
			};
			for (const { name, migratedSettings } of subprojectNpmrcs) {
				if (!isSafeKey(name)) {
					collectedWarnings.push(
						`Skipped subproject named "${name}" — reserved JavaScript property key.`,
					);
					continue;
				}
				const existing = isPlainObject(packageConfigs[name])
					? (packageConfigs[name] as Record<string, unknown>)
					: {};
				const merged = { ...existing };
				mergeSettings(merged, migratedSettings);
				const subResult = applyMigrations(merged, workspaceYamlPath);
				collectedWarnings.push(
					...subResult.warnings.map((w) => `(packageConfigs["${name}"]) ${w}`),
				);
				packageConfigs[name] = merged;
			}
			next.packageConfigs = packageConfigs;
		}

		const result = applyMigrations(next, workspaceYamlPath);
		collectedWarnings.push(...result.warnings);
		if (result.devEnginesRuntime) {
			devEnginesRuntime = result.devEnginesRuntime;
		}

		const originalYaml = workspaceYamlExists
			? readFileSync(workspaceYamlPath, "utf8")
			: "";
		const nextYaml = YAML.stringify(next, { singleQuote: true });
		if (nextYaml !== originalYaml) {
			writeFileSync(workspaceYamlPath, nextYaml);
			mutatedWorkspaceYaml = true;
		}
	}

	let mutatedPackageJson = false;
	const nextPackageJson: PackageJson = { ...rootPackageJson };

	if ("pnpm" in nextPackageJson) {
		// biome-ignore lint/performance/noDelete: need real removal for serialization
		delete nextPackageJson.pnpm;
		mutatedPackageJson = true;
	}
	if (nextPackageJson.packageManager) {
		const bumped = bumpPackageManager(nextPackageJson.packageManager);
		if (bumped) {
			nextPackageJson.packageManager = bumped;
			mutatedPackageJson = true;
		}
	}
	if (devEnginesRuntime) {
		const existingRuntime = nextPackageJson.devEngines?.runtime;
		if (existingRuntime) {
			collectedWarnings.push(
				`devEngines.runtime is already set (${JSON.stringify(
					existingRuntime,
				)}); useNodeVersion=${devEnginesRuntime.version} was not applied. Resolve the conflict manually.`,
			);
		} else {
			nextPackageJson.devEngines = {
				...nextPackageJson.devEngines,
				runtime: devEnginesRuntime,
			};
			mutatedPackageJson = true;
		}
	}
	if (mutatedPackageJson) {
		writeJson(packageJsonPath, nextPackageJson);
	}

	let mutatedRootNpmrc = false;
	if (rootNpmrc && rootNpmrcContent !== null) {
		mutatedRootNpmrc = writeOrDeleteNpmrc(
			npmrcPath,
			rootNpmrcContent,
			rootNpmrc.linesToKeep,
		);
	}
	let mutatedSubprojectNpmrcs = 0;
	for (const {
		npmrcPath: subPath,
		originalContent,
		linesToKeep,
	} of subprojectNpmrcs) {
		if (writeOrDeleteNpmrc(subPath, originalContent, linesToKeep)) {
			mutatedSubprojectNpmrcs += 1;
		}
	}

	if (collectedWarnings.length > 0) {
		console.log("\nManual follow-up required:");
		for (const warning of collectedWarnings) {
			console.log(`  - ${warning}`);
		}
	}

	console.log(
		"\npnpm v11 migration complete. Run your package manager's install command to refresh the lockfile.",
	);

	return {
		warnings: collectedWarnings,
		mutatedWorkspaceYaml,
		mutatedPackageJson,
		mutatedRootNpmrc,
		mutatedSubprojectNpmrcs,
	};
};
