import type { PnpmSettings } from "./migrations.js";

export type ParsedNpmrc = {
	// Original lines that should stay in the `.npmrc` file (auth/registry,
	// comments, and blanks). Preserved in order so re-serializing retains
	// the original formatting.
	linesToKeep: string[];
	// Settings that need to move out of `.npmrc` (no longer read in v11
	// except for auth/registry). Keys are already in pnpm's camelCase form.
	migratedSettings: PnpmSettings;
};

// Root-level keys that pnpm v11 still reads from `.npmrc`. Anything not in
// this set and not scoped (`@foo:`, `//host/:`) is treated as migratable.
const AUTH_ROOT_KEYS = new Set([
	"_auth",
	"_authToken",
	"_password",
	"_cacert",
	"always-auth",
	"auth-type",
	"ca",
	"cafile",
	"cert",
	"certfile",
	"email",
	"key",
	"keyfile",
	"npm-auth-strategy",
	"registry",
	"username",
]);

const isAuthOrRegistryKey = (key: string): boolean => {
	if (key.startsWith("@") && key.includes(":")) return true;
	if (key.startsWith("//")) return true;
	return AUTH_ROOT_KEYS.has(key);
};

const camelize = (key: string): string =>
	key.replace(/-(.)/g, (_, c: string) => c.toUpperCase());

const unquote = (raw: string): string => {
	const trimmed = raw.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
};

const parseValue = (raw: string): unknown => {
	const trimmed = raw.trim();
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
	return unquote(trimmed);
};

type ParsedLine = {
	key: string;
	value: string;
	isArray: boolean;
};

const parseLine = (line: string): ParsedLine | null => {
	const trimmed = line.trim();
	if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) {
		return null;
	}
	const eqIdx = line.indexOf("=");
	if (eqIdx === -1) return null;
	let key = line.slice(0, eqIdx).trim();
	const value = line.slice(eqIdx + 1);
	const isArray = key.endsWith("[]");
	if (isArray) key = key.slice(0, -2);
	return { key, value, isArray };
};

export const parseNpmrc = (content: string): ParsedNpmrc => {
	const linesToKeep: string[] = [];
	const migratedSettings: PnpmSettings = {};

	for (const line of content.split(/\r?\n/)) {
		const parsed = parseLine(line);
		if (!parsed) {
			linesToKeep.push(line);
			continue;
		}
		const { key, value, isArray } = parsed;
		if (isAuthOrRegistryKey(key)) {
			linesToKeep.push(line);
			continue;
		}
		const camelKey = camelize(key);
		const parsedValue = parseValue(value);
		if (isArray) {
			const existing = migratedSettings[camelKey];
			if (Array.isArray(existing)) {
				existing.push(parsedValue);
			} else {
				migratedSettings[camelKey] = [parsedValue];
			}
		} else {
			migratedSettings[camelKey] = parsedValue;
		}
	}

	return { linesToKeep, migratedSettings };
};

// Serialize `linesToKeep` back into a `.npmrc` body. Returns `null` if the
// resulting file would be blank (indicating the caller should delete it).
// Comment-only and blank-line-interspersed input is preserved verbatim so
// any lines the caller chose to keep round-trip byte-for-byte.
export const serializeNpmrc = (linesToKeep: string[]): string | null => {
	if (linesToKeep.length === 0) return null;
	const body = linesToKeep.join("\n");
	if (body.trim() === "") return null;
	return body.endsWith("\n") ? body : `${body}\n`;
};
