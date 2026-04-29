This codemod migrates a pnpm v10 project to pnpm v11.

```sh
cd /path/to/your/project
codemod run pnpm-v10-to-v11
```

## Running locally

```sh
# From the repo root:
pnpm --filter pnpm-codemod-v11 build

# Then, from the project you want to migrate:
cd /path/to/your/project
pnpx codemod@latest workflow run -w /path/to/codemod/v11 --allow-fs --allow-child-process
```

## What it does

The codemod runs against the workspace root (and every package when a `pnpm-workspace.yaml` is present) and applies the following automatable migrations from the [pnpm v11 changelog](https://github.com/pnpm/pnpm/blob/main/pnpm/CHANGELOG.md):

### Moves settings out of `package.json#pnpm` into `pnpm-workspace.yaml`

In v11, pnpm no longer reads settings from the `pnpm` field of `package.json`. Every known setting under `pnpm.*` is moved to the top level of `pnpm-workspace.yaml`. If `pnpm-workspace.yaml` does not exist, it is created.

### Splits `.npmrc` into auth/registry vs. everything else

In v11, only auth and registry settings are read from `.npmrc`. For the root `.npmrc` and every workspace subproject `.npmrc`, the codemod:

- Keeps auth, token, and registry lines (`registry`, `@scope:registry`, `//host/:_authToken`, `email`, `cafile`, etc.) in `.npmrc`.
- Moves every other setting out, converting the key to camelCase (`hoist-pattern[]` → `hoistPattern`, `save-exact` → `saveExact`, and so on) and typing the value (`true`/`false`/number/string).
- Root-level migrated settings land at the top of `pnpm-workspace.yaml`.
- Subproject migrated settings land under `packageConfigs["<project-name>"]` in the root `pnpm-workspace.yaml`, keyed by the subproject's `package.json#name`.
- Deletes the `.npmrc` file if nothing was left to keep.

### Consolidates build-dependency settings into `allowBuilds`

The following settings are removed in v11 and merged into a single `allowBuilds` map:

| Old setting                  | Translated to                           |
| ---------------------------- | --------------------------------------- |
| `onlyBuiltDependencies`      | `allowBuilds: { <name>: true }`         |
| `neverBuiltDependencies`     | `allowBuilds: { <name>: false }`        |
| `ignoredBuiltDependencies`   | `allowBuilds: { <name>: false }`        |
| `onlyBuiltDependenciesFile`  | each entry merged in as `true`          |

The `ignoreDepScripts` setting has no equivalent — the codemod removes it and prints a warning.

### Replaces the package-manager strictness settings with `pmOnFail`

| Removed setting                       | Replacement                    |
| ------------------------------------- | ------------------------------ |
| `managePackageManagerVersions: true`  | `pmOnFail: download`           |
| `managePackageManagerVersions: false` | `pmOnFail: ignore`             |
| `packageManagerStrict: false`         | `pmOnFail: warn`               |
| `packageManagerStrictVersion: true`   | `pmOnFail: error`              |

### Renames

- `allowNonAppliedPatches` → `allowUnusedPatches`
- `auditConfig.ignoreCves` → `auditConfig.ignoreGhsas` (the key is renamed; the codemod prints a warning that each CVE id needs to be replaced with the corresponding GHSA id manually)
- `useNodeVersion` → `devEngines.runtime` in the root `package.json` (populated as `{ name: "node", version: "<value>" }`; if `devEngines.runtime` is already set, the conflict is reported as a warning and left untouched)

### Removes

- `ignorePatchFailures` (v11 always throws on a failed patch)

### Bumps the `packageManager` field in `package.json`

If the root `package.json` pins pnpm below v11 via `packageManager`, it is bumped to the latest pnpm v11 release. The exact version is resolved at runtime from the `latest-11` dist-tag on the npm registry. If the registry is unreachable, the codemod falls back to a pinned version (currently `pnpm@11.0.1`).

## Things the codemod will NOT do automatically

The following v11 changes require human judgement and are only reported as warnings:

- `executionEnv.nodeVersion` in workspace subpackages. Declare `devEngines.runtime` in that subpackage's `package.json` instead.
- `npm_config_*` environment variables are no longer read. Rename them to `pnpm_config_*`.
- `pnpm link <pkg-name>` no longer resolves from the global store — use a relative or absolute path.
- `pnpm install -g` (with no args) is no longer supported — use `pnpm add -g <pkg>`.
