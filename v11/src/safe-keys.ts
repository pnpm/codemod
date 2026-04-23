// Keys that would mutate the prototype chain of a plain object if used as
// own properties. Since this codemod copies user-controlled keys out of
// `.npmrc`, `package.json#pnpm`, and workspace package names, every such
// boundary must filter these out.
export const UNSAFE_KEYS: ReadonlySet<string> = new Set([
	"__proto__",
	"constructor",
	"prototype",
]);

export const isSafeKey = (key: string): boolean => !UNSAFE_KEYS.has(key);

// Prefer Object.hasOwn over `key in obj`: the latter consults the
// prototype chain and returns true for inherited properties like
// `constructor`, which is wrong when deciding whether a user-supplied
// key was already set.
export const hasOwn = (obj: object, key: string): boolean =>
	Object.hasOwn(obj, key);
