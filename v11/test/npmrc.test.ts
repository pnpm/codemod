import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseNpmrc, serializeNpmrc } from "../src/npmrc.js";

describe("parseNpmrc — keeps auth/registry lines intact", () => {
	test("leaves scoped registries, host tokens, and default registry alone", () => {
		const { linesToKeep, migratedSettings } = parseNpmrc(
			[
				"registry=https://registry.npmjs.org/",
				"@my-org:registry=https://private.example.com/",
				"//registry.npmjs.org/:_authToken=xxx",
				"//private.example.com/:_password=yyy",
				"_authToken=zzz",
				"always-auth=true",
				"cafile=./ca.pem",
				"email=dev@example.com",
			].join("\n"),
		);
		assert.deepEqual(linesToKeep, [
			"registry=https://registry.npmjs.org/",
			"@my-org:registry=https://private.example.com/",
			"//registry.npmjs.org/:_authToken=xxx",
			"//private.example.com/:_password=yyy",
			"_authToken=zzz",
			"always-auth=true",
			"cafile=./ca.pem",
			"email=dev@example.com",
		]);
		assert.deepEqual(migratedSettings, {});
	});

	test("preserves comments and blank lines", () => {
		const { linesToKeep } = parseNpmrc(
			[
				"# auth",
				"registry=https://registry.npmjs.org/",
				"",
				"; another comment",
			].join("\n"),
		);
		assert.deepEqual(linesToKeep, [
			"# auth",
			"registry=https://registry.npmjs.org/",
			"",
			"; another comment",
		]);
	});
});

describe("parseNpmrc — migrates non-auth settings", () => {
	test("kebab-case keys become camelCase", () => {
		const { migratedSettings } = parseNpmrc(
			["hoist-pattern=*eslint*", "save-exact=true"].join("\n"),
		);
		assert.deepEqual(migratedSettings, {
			hoistPattern: "*eslint*",
			saveExact: true,
		});
	});

	test("array notation key[] accumulates into an array", () => {
		const { migratedSettings } = parseNpmrc(
			["hoist-pattern[]=*eslint*", "hoist-pattern[]=*prettier*"].join("\n"),
		);
		assert.deepEqual(migratedSettings, {
			hoistPattern: ["*eslint*", "*prettier*"],
		});
	});

	test("values are typed (boolean, number, string)", () => {
		const { migratedSettings } = parseNpmrc(
			[
				"strict-peer-dependencies=true",
				"auto-install-peers=false",
				"minimum-release-age=1440",
				"node-linker=hoisted",
			].join("\n"),
		);
		assert.deepEqual(migratedSettings, {
			strictPeerDependencies: true,
			autoInstallPeers: false,
			minimumReleaseAge: 1440,
			nodeLinker: "hoisted",
		});
	});

	test("surrounding quotes are stripped from string values", () => {
		const { migratedSettings } = parseNpmrc('save-prefix="~"\n');
		assert.deepEqual(migratedSettings, { savePrefix: "~" });
	});
});

describe("parseNpmrc — mixed content", () => {
	test("splits a real-world .npmrc correctly", () => {
		const content = [
			"# project defaults",
			"registry=https://registry.npmjs.org/",
			"@my-org:registry=https://private.example.com/",
			"//private.example.com/:_authToken=secret",
			"",
			"hoist-pattern[]=*types*",
			"hoist-pattern[]=*eslint*",
			"save-exact=true",
			"node-linker=hoisted",
		].join("\n");

		const { linesToKeep, migratedSettings } = parseNpmrc(content);

		assert.deepEqual(linesToKeep, [
			"# project defaults",
			"registry=https://registry.npmjs.org/",
			"@my-org:registry=https://private.example.com/",
			"//private.example.com/:_authToken=secret",
			"",
		]);
		assert.deepEqual(migratedSettings, {
			hoistPattern: ["*types*", "*eslint*"],
			saveExact: true,
			nodeLinker: "hoisted",
		});
	});
});

describe("serializeNpmrc", () => {
	test("returns null when the result would be entirely blank", () => {
		assert.equal(serializeNpmrc([]), null);
		assert.equal(serializeNpmrc(["", "  ", ""]), null);
	});

	test("preserves comment-only content rather than discarding it", () => {
		assert.equal(serializeNpmrc(["# just a note"]), "# just a note\n");
	});

	test("preserves original whitespace on kept lines (no trim)", () => {
		assert.equal(
			serializeNpmrc(["  registry=https://registry.npmjs.org/  "]),
			"  registry=https://registry.npmjs.org/  \n",
		);
	});

	test("joins kept lines and appends a trailing newline", () => {
		assert.equal(
			serializeNpmrc(["# header", "registry=https://registry.npmjs.org/", ""]),
			"# header\nregistry=https://registry.npmjs.org/\n",
		);
	});
});
