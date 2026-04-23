import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { type PnpmSettings, applyMigrations } from "../src/migrations.js";

const FAKE_WORKSPACE_PATH = "/tmp/fake/pnpm-workspace.yaml";

const migrate = (
	settings: PnpmSettings,
	settingsFilePath = FAKE_WORKSPACE_PATH,
) => {
	const warnings = applyMigrations(settings, settingsFilePath);
	return { settings, warnings };
};

describe("allowBuilds consolidation", () => {
	test("merges onlyBuiltDependencies as true", () => {
		const { settings, warnings } = migrate({
			onlyBuiltDependencies: ["electron", "sharp"],
		});
		assert.deepEqual(settings.allowBuilds, { electron: true, sharp: true });
		assert.ok(!("onlyBuiltDependencies" in settings));
		assert.equal(warnings.length, 0);
	});

	test("merges neverBuiltDependencies and ignoredBuiltDependencies as false", () => {
		const { settings } = migrate({
			neverBuiltDependencies: ["core-js"],
			ignoredBuiltDependencies: ["esbuild"],
		});
		assert.deepEqual(settings.allowBuilds, {
			"core-js": false,
			esbuild: false,
		});
		assert.ok(!("neverBuiltDependencies" in settings));
		assert.ok(!("ignoredBuiltDependencies" in settings));
	});

	test("existing allowBuilds verdicts win over legacy lists", () => {
		const { settings } = migrate({
			allowBuilds: { electron: false },
			onlyBuiltDependencies: ["electron", "esbuild"],
		});
		assert.deepEqual(settings.allowBuilds, {
			electron: false,
			esbuild: true,
		});
	});

	test("does not emit allowBuilds when all inputs are empty", () => {
		const { settings } = migrate({
			onlyBuiltDependencies: [],
			neverBuiltDependencies: [],
		});
		assert.ok(!("allowBuilds" in settings));
	});

	test("ignoreDepScripts is removed with a warning", () => {
		const { settings, warnings } = migrate({ ignoreDepScripts: true });
		assert.ok(!("ignoreDepScripts" in settings));
		assert.equal(warnings.length, 1);
		assert.match(warnings[0] as string, /ignoreDepScripts/);
	});

	test("onlyBuiltDependenciesFile reads the referenced JSON file", () => {
		const dir = mkdtempSync(join(tmpdir(), "pnpm-codemod-v11-"));
		try {
			const allowFile = join(dir, "allowed-builds.json");
			writeFileSync(allowFile, JSON.stringify(["electron", "sharp"]));

			const { settings, warnings } = migrate(
				{ onlyBuiltDependenciesFile: "allowed-builds.json" },
				join(dir, "pnpm-workspace.yaml"),
			);

			assert.deepEqual(settings.allowBuilds, {
				electron: true,
				sharp: true,
			});
			assert.ok(!("onlyBuiltDependenciesFile" in settings));
			assert.equal(warnings.length, 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("onlyBuiltDependenciesFile emits a warning when the file is missing", () => {
		const { settings, warnings } = migrate({
			onlyBuiltDependenciesFile: "missing.json",
		});
		assert.ok(!("onlyBuiltDependenciesFile" in settings));
		assert.ok(!("allowBuilds" in settings));
		assert.equal(warnings.length, 1);
		assert.match(warnings[0] as string, /onlyBuiltDependenciesFile/);
	});
});

describe("pmOnFail consolidation", () => {
	test("packageManagerStrictVersion: true → error", () => {
		const { settings } = migrate({ packageManagerStrictVersion: true });
		assert.equal(settings.pmOnFail, "error");
		assert.ok(!("packageManagerStrictVersion" in settings));
	});

	test("packageManagerStrict: false → warn", () => {
		const { settings } = migrate({ packageManagerStrict: false });
		assert.equal(settings.pmOnFail, "warn");
		assert.ok(!("packageManagerStrict" in settings));
	});

	test("managePackageManagerVersions: false → ignore", () => {
		const { settings } = migrate({ managePackageManagerVersions: false });
		assert.equal(settings.pmOnFail, "ignore");
		assert.ok(!("managePackageManagerVersions" in settings));
	});

	test("managePackageManagerVersions: true → download", () => {
		const { settings } = migrate({ managePackageManagerVersions: true });
		assert.equal(settings.pmOnFail, "download");
	});

	test("strict: false overrides a previously-chosen download", () => {
		const { settings } = migrate({
			managePackageManagerVersions: true,
			packageManagerStrict: false,
		});
		assert.equal(settings.pmOnFail, "warn");
	});

	test("strictVersion: true overrides everything else", () => {
		const { settings } = migrate({
			managePackageManagerVersions: true,
			packageManagerStrict: false,
			packageManagerStrictVersion: true,
		});
		assert.equal(settings.pmOnFail, "error");
	});

	test("existing pmOnFail is preserved and legacy keys dropped", () => {
		const { settings } = migrate({
			pmOnFail: "error",
			managePackageManagerVersions: false,
			packageManagerStrict: false,
			packageManagerStrictVersion: false,
		});
		assert.equal(settings.pmOnFail, "error");
		assert.ok(!("managePackageManagerVersions" in settings));
		assert.ok(!("packageManagerStrict" in settings));
		assert.ok(!("packageManagerStrictVersion" in settings));
	});
});

describe("renames and removals", () => {
	test("allowNonAppliedPatches is renamed to allowUnusedPatches", () => {
		const { settings } = migrate({ allowNonAppliedPatches: true });
		assert.equal(settings.allowUnusedPatches, true);
		assert.ok(!("allowNonAppliedPatches" in settings));
	});

	test("allowNonAppliedPatches does not overwrite an existing allowUnusedPatches", () => {
		const { settings } = migrate({
			allowNonAppliedPatches: true,
			allowUnusedPatches: false,
		});
		assert.equal(settings.allowUnusedPatches, false);
		assert.ok(!("allowNonAppliedPatches" in settings));
	});

	test("ignorePatchFailures is removed with a warning", () => {
		const { settings, warnings } = migrate({ ignorePatchFailures: true });
		assert.ok(!("ignorePatchFailures" in settings));
		assert.equal(warnings.length, 1);
		assert.match(warnings[0] as string, /ignorePatchFailures/);
	});

	test("useNodeVersion is removed with a warning including the previous value", () => {
		const { settings, warnings } = migrate({ useNodeVersion: "20.11.1" });
		assert.ok(!("useNodeVersion" in settings));
		assert.equal(warnings.length, 1);
		assert.match(warnings[0] as string, /useNodeVersion/);
		assert.match(warnings[0] as string, /20\.11\.1/);
	});

	test("auditConfig.ignoreCves is renamed to ignoreGhsas with a warning", () => {
		const { settings, warnings } = migrate({
			auditConfig: { ignoreCves: ["CVE-2024-1234"] },
		});
		assert.deepEqual(settings.auditConfig, {
			ignoreGhsas: ["CVE-2024-1234"],
		});
		assert.equal(warnings.length, 1);
		assert.match(warnings[0] as string, /ignoreCves/);
	});

	test("auditConfig.ignoreCves: [] is removed silently", () => {
		const { settings, warnings } = migrate({
			auditConfig: { ignoreCves: [] },
		});
		assert.deepEqual(settings.auditConfig, {});
		assert.equal(warnings.length, 0);
	});
});

describe("end-to-end", () => {
	test("full v10 manifest migrates cleanly with expected warnings", () => {
		const { settings, warnings } = migrate({
			onlyBuiltDependencies: ["electron"],
			neverBuiltDependencies: ["core-js"],
			ignoredBuiltDependencies: ["esbuild"],
			managePackageManagerVersions: false,
			allowNonAppliedPatches: true,
			ignorePatchFailures: true,
			useNodeVersion: "20.11.1",
			auditConfig: { ignoreCves: ["CVE-2024-1234"] },
			patchedDependencies: { "foo@1.0.0": "patches/foo.patch" },
		});

		assert.deepEqual(settings, {
			allowBuilds: { electron: true, "core-js": false, esbuild: false },
			pmOnFail: "ignore",
			allowUnusedPatches: true,
			auditConfig: { ignoreGhsas: ["CVE-2024-1234"] },
			patchedDependencies: { "foo@1.0.0": "patches/foo.patch" },
		});
		assert.equal(warnings.length, 3);
	});

	test("unrelated settings are left alone", () => {
		const { settings, warnings } = migrate({
			catalog: { react: "^18.0.0" },
			packages: ["apps/*"],
		});
		assert.deepEqual(settings, {
			catalog: { react: "^18.0.0" },
			packages: ["apps/*"],
		});
		assert.equal(warnings.length, 0);
	});
});
