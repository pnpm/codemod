import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { globSync } from "glob";
import * as semver from "semver";
import * as YAML from "yaml";

// `Map` is used instead of a plain object so that dependency names coming
// from user-controlled `package.json` files cannot trigger prototype
// pollution (e.g. a `__proto__` entry would only land in Map storage).
type PackagesVersions = Map<string, PackageUsage>;

type PackageUsage = {
	versions: string[];
	dependents: string[];
};

const UNSAFE_KEYS: ReadonlySet<string> = new Set([
	"__proto__",
	"constructor",
	"prototype",
]);

type PackageJson = {
	name?: string;
	packageManager?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};

type WorkspaceYaml = {
	packages?: string[];
	catalog?: Record<string, string>;
	[key: string]: unknown;
};

const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
] as const;

const isAlias = (version: string): boolean => version.startsWith("npm:");

const validRange = (version: string): boolean =>
	semver.validRange(version) !== null;

const readDependencies = (
	packagesVersions: PackagesVersions,
	packageName: string,
	dependencies: Record<string, string> | undefined,
): void => {
	if (!dependencies) return;
	for (const [name, version] of Object.entries(dependencies)) {
		if (UNSAFE_KEYS.has(name)) continue;
		if (
			version === "workspace:*" ||
			(!isAlias(version) && !validRange(version))
		) {
			continue;
		}
		const entry = packagesVersions.get(name) ?? {
			versions: [],
			dependents: [],
		};
		if (!entry.versions.includes(version)) entry.versions.push(version);
		if (!entry.dependents.includes(packageName)) {
			entry.dependents.push(packageName);
		}
		packagesVersions.set(name, entry);
	}
};

export type CatalogMigrationRun = {
	moved: number;
	skipped: number;
};

export const runMigration = (
	cwd: string = process.cwd(),
): CatalogMigrationRun => {
	const workspaceYamlPath = resolve(cwd, "pnpm-workspace.yaml");
	if (!existsSync(workspaceYamlPath)) {
		console.log("pnpm-workspace.yaml not found");
		return { moved: 0, skipped: 0 };
	}

	const workspaceYaml =
		(YAML.parse(readFileSync(workspaceYamlPath, "utf8")) as WorkspaceYaml) ??
		{};
	const workspacePackages = workspaceYaml.packages ?? [];

	const packagesVersions: PackagesVersions = new Map();

	const includes = [
		...workspacePackages.filter((p) => !p.startsWith("!")),
		".",
	];
	const excludes = workspacePackages
		.filter((p) => p.startsWith("!"))
		.map((p) => p.slice(1));
	const projectDirs = globSync(includes, {
		cwd,
		ignore: ["**/node_modules/**", ...excludes],
		absolute: true,
	});

	const packageJsonPaths: string[] = [];
	for (const dir of projectDirs) {
		const path = join(dir, "package.json");
		if (existsSync(path)) packageJsonPaths.push(path);
	}

	for (const path of packageJsonPaths) {
		let pkg: PackageJson;
		try {
			pkg = JSON.parse(readFileSync(path, "utf8")) as PackageJson;
		} catch {
			continue;
		}
		if (!pkg.name) continue;
		for (const field of DEPENDENCY_FIELDS) {
			readDependencies(packagesVersions, pkg.name, pkg[field]);
		}
	}

	const selected: [string, PackageUsage][] = [];
	const skipped: [string, PackageUsage][] = [];
	for (const entry of packagesVersions.entries()) {
		const [, { versions, dependents }] = entry;
		if (versions.length === 1 && dependents.length > 1) {
			selected.push(entry);
		} else {
			skipped.push(entry);
		}
	}

	if (selected.length === 0) {
		console.log("No packages selected for catalog");
		return { moved: 0, skipped: skipped.length };
	}

	const mergedCatalog = new Map<string, string>();
	for (const [name, version] of Object.entries(workspaceYaml.catalog ?? {})) {
		if (UNSAFE_KEYS.has(name)) continue;
		mergedCatalog.set(name, version);
	}
	for (const [name, { versions }] of selected) {
		mergedCatalog.set(name, versions[0] as string);
	}
	const sortedCatalog = Object.fromEntries(
		[...mergedCatalog.entries()].sort(([a], [b]) => a.localeCompare(b)),
	);

	const nextWorkspace: WorkspaceYaml = {
		...workspaceYaml,
		catalog: sortedCatalog,
	};
	const nextYaml = YAML.stringify(nextWorkspace);
	const originalYaml = readFileSync(workspaceYamlPath, "utf8");
	if (nextYaml !== originalYaml) {
		writeFileSync(workspaceYamlPath, nextYaml);
	}

	const movedNames = new Set<string>(selected.map(([name]) => name));
	for (const path of packageJsonPaths) {
		let pkg: PackageJson;
		try {
			pkg = JSON.parse(readFileSync(path, "utf8")) as PackageJson;
		} catch {
			continue;
		}
		let changed = false;
		for (const field of DEPENDENCY_FIELDS) {
			const deps = pkg[field];
			if (!deps) continue;
			for (const name of Object.keys(deps)) {
				if (movedNames.has(name)) {
					deps[name] = "catalog:";
					changed = true;
				}
			}
		}
		if (pkg.packageManager) {
			const version = /^pnpm@(.*)$/.exec(pkg.packageManager)?.[1];
			if (version && semver.valid(version) && semver.lt(version, "9.5.0")) {
				pkg.packageManager = "pnpm@9.5.0";
				changed = true;
			}
		}
		if (changed) {
			writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
		}
	}

	const tail =
		skipped.length > 0 ? `\nPackages not moved: ${skipped.length}\n` : "";
	console.log(
		`\n${selected.length} packages were safely moved to the catalog.${tail}`,
	);

	return { moved: selected.length, skipped: skipped.length };
};
