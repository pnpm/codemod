This codemod migrates a pnpm v10 project to pnpm v11.

```sh
pnpx codemod pnpm/v11
```

## What it does

The codemod runs against the workspace root (and every package when a `pnpm-workspace.yaml` is present) and applies the following automatable migrations from the [pnpm v11 changelog](https://github.com/pnpm/pnpm/blob/main/pnpm/CHANGELOG.md):

### Moves settings out of `package.json#pnpm` into `pnpm-workspace.yaml`

In v11, pnpm no longer reads settings from the `pnpm` field of `package.json`. Every known setting under `pnpm.*` is moved to the top level of `pnpm-workspace.yaml`. If `pnpm-workspace.yaml` does not exist, it is created.

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

If the root `package.json` pins pnpm below v11 via `packageManager`, it is bumped to `pnpm@11.0.0-rc.5`.

## Things the codemod will NOT do automatically

The following v11 changes require human judgement and are only reported as warnings:

- Non-auth/registry settings in `.npmrc` are no longer read. Move them to `pnpm-workspace.yaml` or `~/.config/pnpm/config.yaml` manually.
- `executionEnv.nodeVersion` in workspace subpackages. Declare `devEngines.runtime` in that subpackage's `package.json` instead.
- `npm_config_*` environment variables are no longer read. Rename them to `pnpm_config_*`.
- `pnpm link <pkg-name>` no longer resolves from the global store — use a relative or absolute path.
- `pnpm install -g` (with no args) is no longer supported — use `pnpm add -g <pkg>`.
