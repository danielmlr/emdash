import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

export const CONFIG_FILE_NAME = "fleet.config.ts";

const SITE_KEY_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);

export type SiteLayout = "shared" | "repo";

export interface SiteEntry {
	url: string;
	/** From the entry or `defaults`; every site needs one. */
	layout?: SiteLayout;
	groups?: string[];
}

export interface FleetConfig {
	/** Stored in each site's marker; never changes. */
	name: string;
	defaults?: Partial<SiteEntry>;
	/** Keyed by site key: `^[a-z][a-z0-9-]{0,39}$`, never changes and never names another site. */
	sites: Record<string, SiteEntry>;
}

/** A site entry with `defaults` applied. */
export interface FleetSite {
	key: string;
	url: string;
	layout: SiteLayout;
	groups: string[];
}

export interface LoadedFleet {
	name: string;
	/** Absolute path of the config file. */
	configPath: string;
	/** Sites in the order the config lists them. */
	sites: FleetSite[];
	/** The config's default export as written, including fields this version doesn't read. */
	config: FleetConfig;
}

export type FleetConfigErrorCode =
	| "CONFIG_NOT_FOUND"
	| "CONFIG_LOAD_FAILED"
	| "CONFIG_INVALID"
	| "TYPESCRIPT_UNSUPPORTED";

export class FleetConfigError extends Error {
	override readonly name = "FleetConfigError";

	constructor(
		readonly code: FleetConfigErrorCode,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
	}
}

/** Types a fleet config. The config is validated when a command loads it. */
export function defineFleet(config: FleetConfig): FleetConfig {
	return config;
}

function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

const layoutSchema = z.enum(["shared", "repo"]);
const groupsSchema = z.array(z.string().min(1, "must not be empty"));

// Loose objects keep fields that later versions of the config add, so a config
// written for a newer command still loads here.
const siteEntrySchema = z.looseObject({
	url: z.string().refine(isHttpUrl, "must be an http or https URL"),
	layout: layoutSchema.optional(),
	groups: groupsSchema.optional(),
});

const defaultsSchema = z.looseObject({
	layout: layoutSchema.optional(),
	groups: groupsSchema.optional(),
});

const fleetConfigSchema = z.looseObject({
	name: z.string().min(1, "must not be empty"),
	defaults: defaultsSchema.optional(),
	sites: z.record(
		z
			.string()
			.regex(
				SITE_KEY_PATTERN,
				"isn't a valid site key: use up to 40 lower-case letters, digits and hyphens, starting with a letter",
			),
		siteEntrySchema,
	),
});

function formatPath(path: readonly PropertyKey[]): string {
	let formatted = "";
	for (const segment of path) {
		if (typeof segment === "number") formatted += `[${segment}]`;
		else formatted += formatted ? `.${String(segment)}` : String(segment);
	}
	return formatted || "(config)";
}

function firstIssue(error: z.ZodError): { path: string; message: string } {
	const issue = error.issues[0];
	if (!issue) return { path: "(config)", message: "is invalid" };
	const nested = issue.code === "invalid_key" ? issue.issues[0]?.message : undefined;
	return { path: formatPath(issue.path), message: nested ?? issue.message };
}

/**
 * Validates a config's default export and applies `defaults` to every site.
 * Throws `CONFIG_INVALID` naming the path of the first wrong value.
 */
export function resolveFleetConfig(value: unknown, configPath: string): LoadedFleet {
	const parsed = fleetConfigSchema.safeParse(value);
	if (!parsed.success) {
		const issue = firstIssue(parsed.error);
		throw new FleetConfigError("CONFIG_INVALID", `${configPath}: ${issue.path}: ${issue.message}`);
	}

	const { name, defaults, sites } = parsed.data;
	const resolved: FleetSite[] = [];
	for (const [key, entry] of Object.entries(sites)) {
		const layout = entry.layout ?? defaults?.layout;
		if (!layout) {
			throw new FleetConfigError(
				"CONFIG_INVALID",
				`${configPath}: sites.${key}.layout: is missing; set it in the entry or in defaults`,
			);
		}
		resolved.push({ key, url: entry.url, layout, groups: entry.groups ?? defaults?.groups ?? [] });
	}

	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- validated above; loose objects keep later fields
	return { name, configPath, sites: resolved, config: value as FleetConfig };
}

export interface LoadFleetConfigOptions {
	/** Path of the config file, relative to `cwd`. Default: `fleet.config.ts` in `cwd`. */
	config?: string;
	/** Default: `process.cwd()`. */
	cwd?: string;
}

/** Finds, imports and validates the fleet config. */
export async function loadFleetConfig(options: LoadFleetConfigOptions = {}): Promise<LoadedFleet> {
	const cwd = options.cwd ?? process.cwd();
	const configPath = resolve(cwd, options.config ?? CONFIG_FILE_NAME);

	if (!existsSync(configPath)) {
		throw new FleetConfigError(
			"CONFIG_NOT_FOUND",
			options.config
				? `${configPath} doesn't exist.`
				: `No ${CONFIG_FILE_NAME} in ${cwd}. Run the command in the directory that holds it, or pass --config <path>.`,
		);
	}

	if (TYPESCRIPT_EXTENSIONS.has(extname(configPath)) && !process.features.typescript) {
		throw new FleetConfigError(
			"TYPESCRIPT_UNSUPPORTED",
			`${configPath} is TypeScript, which Node.js ${process.version} doesn't run. Use Node.js 22.18 or later.`,
		);
	}

	let module: { default?: unknown };
	try {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- a module namespace object
		module = (await import(pathToFileURL(configPath).href)) as { default?: unknown };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new FleetConfigError("CONFIG_LOAD_FAILED", `Couldn't load ${configPath}: ${reason}`, {
			cause: error,
		});
	}

	if (module.default === undefined) {
		throw new FleetConfigError(
			"CONFIG_INVALID",
			`${configPath} has no default export. Export the config with \`export default defineFleet({ ... })\`.`,
		);
	}

	return resolveFleetConfig(module.default, configPath);
}
