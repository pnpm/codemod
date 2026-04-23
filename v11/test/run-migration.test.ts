import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import * as YAML from "yaml";
import { runMigration } from "../src/index.js";

const setupWorkspace = () => {
	const root = mkdtempSync(join(tmpdir(), "pnpm-codemod-v11-e2e-"));

	writeFileSync(
		join(root, "package.json"),
		JSON.stringify(
			{
				name: "root",
				packageManager: "pnpm@10.5.0",
				pnpm: {
					onlyBuiltDependencies: ["electron"],
					useNodeVersion: "20.11.1",
					managePackageManagerVersions: false,
				},
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		"packages:\n  - apps/*\n  - packages/*\n",
	);
	writeFileSync(
		join(root, ".npmrc"),
		[
			"registry=https://registry.npmjs.org/",
			"//registry.npmjs.org/:_authToken=secret",
			"hoist-pattern[]=*types*",
			"node-linker=hoisted",
			"",
		].join("\n"),
	);

	mkdirSync(join(root, "apps/web"), { recursive: true });
	writeFileSync(
		join(root, "apps/web/package.json"),
		JSON.stringify({ name: "@fixture/web" }),
	);
	writeFileSync(
		join(root, "apps/web/.npmrc"),
		'save-prefix="~"\nauto-install-peers=false\n',
	);

	mkdirSync(join(root, "packages/lib"), { recursive: true });
	writeFileSync(
		join(root, "packages/lib/package.json"),
		JSON.stringify({ name: "@fixture/lib" }),
	);
	writeFileSync(
		join(root, "packages/lib/.npmrc"),
		"# auth only\n//registry.npmjs.org/:_authToken=libtoken\n",
	);

	return root;
};

describe("runMigration — end-to-end", () => {
	test("performs the full workspace migration", () => {
		const root = setupWorkspace();
		try {
			const result = runMigration(root);

			const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
			assert.equal(pkg.packageManager, "pnpm@11.0.0-rc.5");
			assert.ok(!("pnpm" in pkg), "pnpm field should be removed");
			assert.deepEqual(pkg.devEngines.runtime, {
				name: "node",
				version: "20.11.1",
			});

			const ws = YAML.parse(
				readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
			);
			assert.deepEqual(ws.packages, ["apps/*", "packages/*"]);
			assert.deepEqual(ws.allowBuilds, { electron: true });
			assert.equal(ws.pmOnFail, "ignore");
			assert.deepEqual(ws.hoistPattern, ["*types*"]);
			assert.equal(ws.nodeLinker, "hoisted");
			assert.deepEqual(ws.packageConfigs["@fixture/web"], {
				savePrefix: "~",
				autoInstallPeers: false,
			});

			const rootNpmrc = readFileSync(join(root, ".npmrc"), "utf8");
			assert.match(rootNpmrc, /registry=https:\/\/registry\.npmjs\.org\//);
			assert.match(rootNpmrc, /_authToken=secret/);
			assert.doesNotMatch(rootNpmrc, /hoist-pattern/);
			assert.doesNotMatch(rootNpmrc, /node-linker/);

			assert.equal(
				existsSync(join(root, "apps/web/.npmrc")),
				false,
				"auth-less subproject .npmrc should be deleted",
			);
			assert.ok(
				existsSync(join(root, "packages/lib/.npmrc")),
				"auth-only subproject .npmrc should be kept",
			);

			assert.ok(result.mutatedPackageJson);
			assert.ok(result.mutatedWorkspaceYaml);
			assert.ok(result.mutatedRootNpmrc);
			assert.equal(result.mutatedSubprojectNpmrcs, 1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("is a no-op when there is no package.json", () => {
		const root = mkdtempSync(join(tmpdir(), "pnpm-codemod-v11-e2e-"));
		try {
			const result = runMigration(root);
			assert.equal(result.mutatedPackageJson, false);
			assert.equal(result.mutatedWorkspaceYaml, false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("leaves pinned v11 packageManager alone", () => {
		const root = mkdtempSync(join(tmpdir(), "pnpm-codemod-v11-e2e-"));
		try {
			writeFileSync(
				join(root, "package.json"),
				JSON.stringify({
					name: "already-v11",
					packageManager: "pnpm@11.0.0-rc.5",
				}),
			);
			runMigration(root);
			const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
			assert.equal(pkg.packageManager, "pnpm@11.0.0-rc.5");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
