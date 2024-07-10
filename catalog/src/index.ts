import type { Api } from "@codemod.com/workflow";
import * as semver from "semver";

type PackagesVersions = Record<string, string[]>;

type PackageJson = {
	name: string;
	packageManager?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};

const isAlias = (version: string) => {
	return version.match(/^npm:/)?.length === 1;
};

const validRange = (version: string) => {
	return semver.validRange(version) !== null;
};

const readDependencies = (
	packagesVersions: PackagesVersions,
	dependencies: Record<string, string> = {},
) => {
	for (const [name, version] of Object.entries(dependencies)) {
		if (
			version === "workspace:*" ||
			(!isAlias(version) && !validRange(version))
		) {
			continue;
		}

		if (!packagesVersions[name]) {
			packagesVersions[name] = [];
		}

		if (!packagesVersions[name].includes(version)) {
			packagesVersions[name].push(version);
		}
	}
};

export async function workflow({ files, dirs, exec }: Api) {
	const workspaceFile = files("pnpm-workspace.yaml").yaml();
	const workspaceConfig = (
		await workspaceFile.map(({ getContents }) =>
			getContents<{ packages: string[] }>(),
		)
	).pop();

	if (!workspaceConfig) {
		console.log("pnpm-workspace.yaml not found");
		return;
	}

	const packagesVersions: PackagesVersions = {};

	const packageJsonFiles = dirs({
		dirs: workspaceConfig.packages,
		ignore: ["**/node_modules/**"],
	}).files("package.json");

	await packageJsonFiles.json(async ({ map }) => {
		const packageJson = (
			await map(({ getContents }) => getContents<PackageJson>())
		).pop();

		if (!packageJson) {
			return;
		}

		readDependencies(packagesVersions, packageJson.dependencies);
		readDependencies(packagesVersions, packageJson.devDependencies);
		readDependencies(packagesVersions, packageJson.optionalDependencies);
	});

	const packagesSelected = Object.entries(packagesVersions).filter(
		([_, versions]) => versions.length === 1,
	);
	const packagesNotSelected = Object.entries(packagesVersions).filter(
		([_, versions]) => versions.length > 1,
	);

	if (packagesSelected.length === 0) {
		console.log("No packages selected for catalog");
		return;
	}

	const updateCatalog = Object.fromEntries(
		packagesSelected.map(([name, versions]) => [name, versions[0] as string]),
	);

	await workspaceFile.update<{ catalog: Record<string, string> }>(
		({ catalog, ...rest }) => {
			const sortedCatalog = Object.fromEntries(
				Object.entries({
					...catalog,
					...updateCatalog,
				}).sort(([a], [b]) => a.localeCompare(b)),
			);
			return {
				...rest,
				catalog: sortedCatalog,
			};
		},
	);

	await packageJsonFiles.json().update<PackageJson>((packageJson) => {

		for (const [name] of packagesSelected) {
			if (packageJson.dependencies?.[name]) {
				packageJson.dependencies[name] = "catalog:";
			}
			if (packageJson.devDependencies?.[name]) {
				packageJson.devDependencies[name] = "catalog:";
			}
			if (packageJson.optionalDependencies?.[name]) {
				packageJson.optionalDependencies[name] = "catalog:";
			}
		}

		return packageJson;
	});

	await files("package.json")
		.json()
		.update<PackageJson>((packageJson) => {
			if (packageJson.packageManager) {
				const version = packageJson.packageManager.match(/pnpm@(.*)/)?.[1];
				if (version && semver.lt(version, "9.5.0")) {
					packageJson.packageManager = "pnpm@9.5.0";
				}
			}
			return packageJson;
		});

	await exec("pnpm", ["install"]);

	console.log(`

${packagesSelected.length} packages were safely moved to the catalog.

${
	packagesNotSelected.length
		? `Packages not moved due to version differences: ${packagesNotSelected.length}
`
		: ""
}`);
}
