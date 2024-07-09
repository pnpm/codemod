# Migrate to [pnpm catalog](https://pnpm.io/catalogs)

* Performs search across all packages in pnpm workspace.
* If there are more than 2 packages with same dependency - it will move dependency to catalog.
* If there are multiple versions of dependency - codemod will prompt to choose whether to move to catalog or not (in this case latest version will be picked).
* Automatically updates version in `packageManager` field in `package.json` to 9.5.0 (if it is set and lower than 9.5.0).
* Runs `pnpm install` after migration.
