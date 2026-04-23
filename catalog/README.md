This codemod helps you migrate to [pnpm catalog](https://pnpm.io/catalogs).

```sh
cd /path/to/your/workspace
codemod run pnpm/catalog
```

## What it does

* Scans every `package.json` in the workspace.
* Any dependency version that is used by two or more packages with the same range is moved into `catalog:` in `pnpm-workspace.yaml`; each usage is rewritten to the `"catalog:"` placeholder.
* Dependencies with multiple versions across the workspace are left alone.
* Bumps `packageManager` to `pnpm@9.5.0` when it pins an older pnpm.
* Runs `pnpm install` at the end to refresh the lockfile.
