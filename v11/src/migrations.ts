import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type PnpmSettings = Record<string, unknown>;

type AuditConfig = {
	ignoreCves?: unknown;
	ignoreGhsas?: unknown;
	[key: string]: unknown;
};

export type MigrationWarning = string;

export type DevEnginesRuntime = {
	name: string;
	version: string;
};

export type MigrationResult = {
	warnings: MigrationWarning[];
	devEnginesRuntime?: DevEnginesRuntime;
};

const removeKeys = (obj: Record<string, unknown>, ...keys: string[]): void => {
	for (const key of keys) {
		delete obj[key];
	}
};

// Merge a list of package names into `allowBuilds` under the given verdict, without
// overriding a verdict that was already recorded from an earlier source.
const mergeIntoAllowBuilds = (
	target: Record<string, boolean>,
	names: unknown,
	verdict: boolean,
): void => {
	if (!Array.isArray(names)) return;
	for (const name of names) {
		if (typeof name !== "string" || name in target) continue;
		target[name] = verdict;
	}
};

const readAllowListFile = (
	settingsFilePath: string,
	relativePath: string,
): string[] | null => {
	const absolutePath = resolve(dirname(settingsFilePath), relativePath);
	try {
		const raw = readFileSync(absolutePath, "utf8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((n): n is string => typeof n === "string")
			: null;
	} catch {
		return null;
	}
};

const migrateAllowBuilds = (
	settings: PnpmSettings,
	settingsFilePath: string,
	warnings: MigrationWarning[],
): void => {
	const existing = settings.allowBuilds;
	const allowBuilds: Record<string, boolean> =
		existing && typeof existing === "object" && !Array.isArray(existing)
			? { ...(existing as Record<string, boolean>) }
			: {};

	mergeIntoAllowBuilds(allowBuilds, settings.onlyBuiltDependencies, true);
	mergeIntoAllowBuilds(allowBuilds, settings.neverBuiltDependencies, false);
	mergeIntoAllowBuilds(allowBuilds, settings.ignoredBuiltDependencies, false);

	const allowFile = settings.onlyBuiltDependenciesFile;
	if (typeof allowFile === "string") {
		const entries = readAllowListFile(settingsFilePath, allowFile);
		if (entries) {
			mergeIntoAllowBuilds(allowBuilds, entries, true);
		} else {
			warnings.push(
				`Could not read "${allowFile}" referenced by onlyBuiltDependenciesFile. Inline its entries into allowBuilds manually.`,
			);
		}
	}

	removeKeys(
		settings,
		"onlyBuiltDependencies",
		"neverBuiltDependencies",
		"ignoredBuiltDependencies",
		"onlyBuiltDependenciesFile",
	);

	if ("ignoreDepScripts" in settings) {
		warnings.push(
			`"ignoreDepScripts" has been removed in v11 with no direct equivalent. Declare each dependency explicitly in allowBuilds instead.`,
		);
		removeKeys(settings, "ignoreDepScripts");
	}

	if (Object.keys(allowBuilds).length > 0) {
		settings.allowBuilds = allowBuilds;
	}
};

const migratePmOnFail = (settings: PnpmSettings): void => {
	const legacyKeys = [
		"managePackageManagerVersions",
		"packageManagerStrict",
		"packageManagerStrictVersion",
	] as const;

	if ("pmOnFail" in settings) {
		removeKeys(settings, ...legacyKeys);
		return;
	}

	let pmOnFail: string | undefined;

	if ("managePackageManagerVersions" in settings) {
		pmOnFail =
			settings.managePackageManagerVersions === false ? "ignore" : "download";
	}
	if (settings.packageManagerStrict === false) {
		pmOnFail = "warn";
	}
	if (settings.packageManagerStrictVersion === true) {
		pmOnFail = "error";
	}

	removeKeys(settings, ...legacyKeys);

	if (pmOnFail) {
		settings.pmOnFail = pmOnFail;
	}
};

const migrateRenames = (
	settings: PnpmSettings,
	result: MigrationResult,
): void => {
	if ("allowNonAppliedPatches" in settings) {
		if (!("allowUnusedPatches" in settings)) {
			settings.allowUnusedPatches = settings.allowNonAppliedPatches;
		}
		removeKeys(settings, "allowNonAppliedPatches");
	}

	if ("ignorePatchFailures" in settings) {
		result.warnings.push(
			`"ignorePatchFailures" has been removed in v11. Failed patches now always throw.`,
		);
		removeKeys(settings, "ignorePatchFailures");
	}

	const auditRaw = settings.auditConfig;
	if (
		auditRaw !== null &&
		typeof auditRaw === "object" &&
		!Array.isArray(auditRaw) &&
		"ignoreCves" in auditRaw
	) {
		const audit = auditRaw as AuditConfig;
		const cves = audit.ignoreCves;
		removeKeys(audit, "ignoreCves");
		if (Array.isArray(cves) && cves.length > 0) {
			audit.ignoreGhsas = cves;
			result.warnings.push(
				"auditConfig.ignoreCves was renamed to auditConfig.ignoreGhsas. Replace each CVE-YYYY-NNNNN entry with the matching GHSA-xxxx-xxxx-xxxx id.",
			);
		}
	}

	if ("useNodeVersion" in settings) {
		const value = settings.useNodeVersion;
		if (typeof value === "string" && value.length > 0) {
			result.devEnginesRuntime = { name: "node", version: value };
		} else {
			result.warnings.push(
				`"useNodeVersion" has been removed in v11 and could not be auto-migrated from value ${JSON.stringify(
					value,
				)}. Declare devEngines.runtime in package.json manually.`,
			);
		}
		removeKeys(settings, "useNodeVersion");
	}
};

export const applyMigrations = (
	settings: PnpmSettings,
	settingsFilePath: string,
): MigrationResult => {
	const result: MigrationResult = { warnings: [] };
	migrateAllowBuilds(settings, settingsFilePath, result.warnings);
	migratePmOnFail(settings);
	migrateRenames(settings, result);
	return result;
};
