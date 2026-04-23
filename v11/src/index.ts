import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Api } from "@codemod.com/workflow";
import * as semver from "semver";
import {
	type MigrationWarning,
	type PnpmSettings,
	applyMigrations,
} from "./migrations.js";

const PNPM_V11_VERSION = "11.0.0-rc.5";

type PackageJson = {
	name?: string;
	packageManager?: string;
	pnpm?: PnpmSettings;
	[key: string]: unknown;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const bumpPackageManager = (packageManager: string): string | null => {
	const match = /^pnpm@(.+)$/.exec(packageManager);
	if (!match) return null;
	const current = match[1] as string;
	const coerced = semver.coerce(current);
	if (!coerced) return null;
	if (semver.gte(coerced, "11.0.0")) return null;
	return `pnpm@${PNPM_V11_VERSION}`;
};

export async function workflow({ files }: Api) {
	const cwd = process.cwd();
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

	// The workflow YAML API only operates on files that already exist. When the
	// project has pnpm settings to migrate but no workspace manifest yet, create
	// an empty one so the subsequent update() has something to write to.
	if (!workspaceYamlExists && hasPnpmSettingsInPackageJson) {
		writeFileSync(workspaceYamlPath, "");
	}

	const collectedWarnings: MigrationWarning[] = [];

	if (workspaceYamlExists || hasPnpmSettingsInPackageJson) {
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

				collectedWarnings.push(...applyMigrations(next, workspaceYamlPath));
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
			return packageJson;
		});

	if (existsSync(npmrcPath)) {
		collectedWarnings.push(
			".npmrc exists. In v11 only auth/registry settings are read from .npmrc — move any other pnpm settings (hoistPattern, nodeLinker, shamefullyHoist, etc.) to pnpm-workspace.yaml.",
		);
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
