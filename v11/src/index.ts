import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Api, getCwdContext } from "@codemod.com/workflow";
import { globSync } from "glob";
import * as semver from "semver";
import {
	type DevEnginesRuntime,
	type MigrationWarning,
	type PnpmSettings,
	applyMigrations,
} from "./migrations.js";
import { parseNpmrc, serializeNpmrc } from "./npmrc.js";

const PNPM_V11_VERSION = "11.0.0-rc.5";

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
	linesToKeep: string[];
	migratedSettings: PnpmSettings;
};

// Object keys that can pollute the prototype chain if used as a plain-object
// key. Subproject package names are user-controlled, so any of these names
// are skipped rather than written into `packageConfigs`.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const resolveWorkflowCwd = (): string => {
	try {
		const ctx = getCwdContext();
		if (ctx && typeof ctx.cwd === "string") return ctx.cwd;
	} catch {
		// No workflow context (e.g. direct unit test). Fall through.
	}
	return process.cwd();
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

const writeOrDeleteNpmrc = (npmrcPath: string, linesToKeep: string[]) => {
	const serialized = serializeNpmrc(linesToKeep);
	if (serialized === null) {
		rmSync(npmrcPath, { force: true });
	} else {
		writeFileSync(npmrcPath, serialized);
	}
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

		let packageName: string | undefined;
		try {
			const parsed = JSON.parse(
				readFileSync(packageJsonPath, "utf8"),
			) as PackageJson;
			packageName = parsed.name;
		} catch {
			continue;
		}
		if (!packageName) continue;

		const { linesToKeep, migratedSettings } = parseNpmrc(
			readFileSync(npmrcPath, "utf8"),
		);
		if (Object.keys(migratedSettings).length === 0) continue;

		results.push({
			name: packageName,
			npmrcPath,
			linesToKeep,
			migratedSettings,
		});
	}

	return results;
};

export async function workflow({ files }: Api) {
	const cwd = resolveWorkflowCwd();
	const workspaceYamlPath = resolve(cwd, "pnpm-workspace.yaml");
	const npmrcPath = resolve(cwd, ".npmrc");

	const rootPackageJson = (
		await files("package.json")
			.json()
			.map(({ getContents }) => getContents<PackageJson>())
	).pop();

	if (!rootPackageJson) {
		console.log("package.json not found. Nothing to migrate.");
		return;
	}

	const pnpmSettingsToMigrate: PnpmSettings = isPlainObject(
		rootPackageJson.pnpm,
	)
		? { ...(rootPackageJson.pnpm as PnpmSettings) }
		: {};

	const hasPnpmSettingsInPackageJson =
		Object.keys(pnpmSettingsToMigrate).length > 0;
	const workspaceYamlExists = existsSync(workspaceYamlPath);

	// Read the workspace `packages:` list BEFORE the yaml update, so we can
	// enumerate subproject `.npmrc` files.
	let workspacePackages: string[] = [];
	if (workspaceYamlExists) {
		const existing = (
			await files("pnpm-workspace.yaml")
				.yaml()
				.map(({ getContents }) => getContents<{ packages?: string[] }>())
		).pop();
		workspacePackages = Array.isArray(existing?.packages)
			? (existing?.packages as string[])
			: [];
	}

	const rootNpmrc = existsSync(npmrcPath)
		? parseNpmrc(readFileSync(npmrcPath, "utf8"))
		: null;

	const subprojectNpmrcs = collectSubprojectNpmrc(cwd, workspacePackages);

	const needsWorkspaceYaml =
		workspaceYamlExists ||
		hasPnpmSettingsInPackageJson ||
		(rootNpmrc && Object.keys(rootNpmrc.migratedSettings).length > 0) ||
		subprojectNpmrcs.length > 0;

	// The workflow YAML API only operates on files that already exist. When the
	// project has migratable input but no workspace manifest yet, create one.
	if (!workspaceYamlExists && needsWorkspaceYaml) {
		writeFileSync(workspaceYamlPath, "");
	}

	const collectedWarnings: MigrationWarning[] = [];
	let devEnginesRuntime: DevEnginesRuntime | undefined;

	if (needsWorkspaceYaml) {
		await files("pnpm-workspace.yaml")
			.yaml()
			.update<Record<string, unknown>>((current) => {
				const next: Record<string, unknown> = isPlainObject(current)
					? { ...current }
					: {};

				for (const [key, value] of Object.entries(pnpmSettingsToMigrate)) {
					if (!(key in next)) {
						next[key] = value;
					}
				}

				if (rootNpmrc) {
					for (const [key, value] of Object.entries(
						rootNpmrc.migratedSettings,
					)) {
						if (!(key in next)) {
							next[key] = value;
						}
					}
				}

				if (subprojectNpmrcs.length > 0) {
					const existingPackageConfigs = isPlainObject(next.packageConfigs)
						? (next.packageConfigs as Record<string, unknown>)
						: {};
					const packageConfigs: Record<string, unknown> = {
						...existingPackageConfigs,
					};
					for (const { name, migratedSettings } of subprojectNpmrcs) {
						if (UNSAFE_KEYS.has(name)) {
							collectedWarnings.push(
								`Skipped subproject named "${name}" — reserved JavaScript property key.`,
							);
							continue;
						}
						const existing = isPlainObject(packageConfigs[name])
							? (packageConfigs[name] as Record<string, unknown>)
							: {};
						const merged = { ...existing };
						for (const [k, v] of Object.entries(migratedSettings)) {
							if (!(k in merged)) merged[k] = v;
						}
						const subResult = applyMigrations(merged, workspaceYamlPath);
						collectedWarnings.push(
							...subResult.warnings.map(
								(w) => `(packageConfigs["${name}"]) ${w}`,
							),
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
				return next;
			});
	}

	await files("package.json")
		.json()
		.update<PackageJson>((packageJson) => {
			if ("pnpm" in packageJson) {
				// biome-ignore lint/performance/noDelete: need real removal for serialization
				delete packageJson.pnpm;
			}
			if (packageJson.packageManager) {
				const bumped = bumpPackageManager(packageJson.packageManager);
				if (bumped) {
					packageJson.packageManager = bumped;
				}
			}
			if (devEnginesRuntime) {
				const existingRuntime = packageJson.devEngines?.runtime;
				if (existingRuntime) {
					collectedWarnings.push(
						`devEngines.runtime is already set (${JSON.stringify(
							existingRuntime,
						)}); useNodeVersion=${devEnginesRuntime.version} was not applied. Resolve the conflict manually.`,
					);
				} else {
					packageJson.devEngines = {
						...packageJson.devEngines,
						runtime: devEnginesRuntime,
					};
				}
			}
			return packageJson;
		});

	if (rootNpmrc) {
		writeOrDeleteNpmrc(npmrcPath, rootNpmrc.linesToKeep);
	}
	for (const { npmrcPath: subPath, linesToKeep } of subprojectNpmrcs) {
		writeOrDeleteNpmrc(subPath, linesToKeep);
	}

	if (collectedWarnings.length > 0) {
		console.log("\nManual follow-up required:");
		for (const warning of collectedWarnings) {
			console.log(`  - ${warning}`);
		}
	}

	console.log(
		`\npnpm v11 migration complete. Run your package manager's install command to refresh the lockfile.`,
	);
}
