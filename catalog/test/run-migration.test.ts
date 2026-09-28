import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import * as YAML from "yaml";
import { runMigration } from "../src/index.js";

const writePackage = (
	root: string,
	dir: string,
	dependencies: Record<string, string>,
) => {
	const path = join(root, dir);
	mkdirSync(path, { recursive: true });
	writeFileSync(
		join(path, "package.json"),
		`${JSON.stringify({ name: dir.split("/").join("-"), dependencies }, null, 2)}\n`,
	);
};

const readDeps = (root: string, dir: string): Record<string, string> => {
	const pkg = JSON.parse(
		readFileSync(join(root, dir, "package.json"), "utf8"),
	) as { dependencies: Record<string, string> };
	return pkg.dependencies;
};

describe("named catalog specifiers", () => {
	test("leaves a named catalog specifier next to a single plain range", () => {
		for (const workspaceYaml of [
			"packages:\n  - packages/*\ncatalog:\n  react: ^18.0.0\ncatalogs:\n  graphql15:\n    graphql: ^15.3.0\n",
			"packages:\n  - packages/*\ncatalogs:\n  graphql15:\n    graphql: ^15.3.0\ncatalog:\n  react: ^18.0.0\n",
		]) {
			const root = mkdtempSync(join(tmpdir(), "pnpm-codemod-catalog-"));
			try {
				writeFileSync(join(root, "pnpm-workspace.yaml"), workspaceYaml);
				writePackage(root, "packages/a", { graphql: "^16.0.0" });
				writePackage(root, "packages/b", { graphql: "catalog:graphql15" });

				const result = runMigration(root);

				assert.deepEqual(result, { moved: 0, skipped: 1 });
				assert.equal(
					readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
					workspaceYaml,
				);
				assert.equal(readDeps(root, "packages/a").graphql, "^16.0.0");
				assert.equal(readDeps(root, "packages/b").graphql, "catalog:graphql15");
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	});

	test("moves shared plain ranges without rewriting a named catalog specifier", () => {
		const root = mkdtempSync(join(tmpdir(), "pnpm-codemod-catalog-"));
		try {
			writeFileSync(
				join(root, "pnpm-workspace.yaml"),
				"packages:\n  - packages/*\ncatalog:\n  react: ^18.0.0\ncatalogs:\n  graphql15:\n    graphql: ^15.3.0\n",
			);
			writePackage(root, "packages/a", { graphql: "^15.3.0" });
			writePackage(root, "packages/b", { graphql: "^15.3.0" });
			writePackage(root, "packages/c", { graphql: "catalog:graphql15" });

			const result = runMigration(root);

			assert.equal(result.moved, 1);
			assert.equal(readDeps(root, "packages/a").graphql, "catalog:");
			assert.equal(readDeps(root, "packages/b").graphql, "catalog:");
			assert.equal(readDeps(root, "packages/c").graphql, "catalog:graphql15");
			const workspace = YAML.parse(
				readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
			) as {
				catalog: Record<string, string>;
				catalogs: { graphql15: Record<string, string> };
			};
			assert.equal(workspace.catalog.graphql, "^15.3.0");
			assert.equal(workspace.catalog.react, "^18.0.0");
			assert.equal(workspace.catalogs.graphql15.graphql, "^15.3.0");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
