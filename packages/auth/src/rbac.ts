/**
 * Role-Based Access Control
 */

import type { ApiTokenScope } from "./tokens.js";
import { Role, type RoleLevel } from "./types.js";

/**
 * Permission definitions with minimum role required
 */
export const Permissions = {
	// Content
	"content:read": Role.SUBSCRIBER,
	// content:read_drafts gates non-published content (drafts, scheduled, trash)
	// and editor-only views (revisions, compare, preview-url). Subscribers may
	// hold content:read for member-only published content but must not see
	// drafts.
	"content:read_drafts": Role.CONTRIBUTOR,
	"content:create": Role.CONTRIBUTOR,
	// Lets an owner edit their entry while it is a draft. Published and scheduled
	// entries need content:edit_own, since saving one can change what visitors see.
	"content:edit_own_drafts": Role.CONTRIBUTOR,
	"content:edit_own": Role.AUTHOR,
	"content:edit_any": Role.EDITOR,
	"content:delete_own": Role.AUTHOR,
	"content:delete_any": Role.EDITOR,
	// Permanent deletion (empty trash) is irreversible and bypasses the
	// soft-delete safety net, so it sits at the same authorization tier as
	// other destructive system actions (schema:manage, comments:delete).
	"content:delete_permanent": Role.ADMIN,
	"content:publish_own": Role.AUTHOR,
	"content:publish_any": Role.EDITOR,

	// Media
	"media:read": Role.SUBSCRIBER,
	"media:upload": Role.CONTRIBUTOR,
	"media:edit_own": Role.AUTHOR,
	"media:edit_any": Role.EDITOR,
	"media:delete_own": Role.AUTHOR,
	"media:delete_any": Role.EDITOR,

	// Taxonomies
	"taxonomies:read": Role.SUBSCRIBER,
	"taxonomies:manage": Role.EDITOR,

	// Comments
	"comments:read": Role.SUBSCRIBER,
	"comments:moderate": Role.EDITOR,
	"comments:delete": Role.ADMIN,
	"comments:settings": Role.ADMIN,

	// Menus
	"menus:read": Role.SUBSCRIBER,
	"menus:manage": Role.EDITOR,

	// Bylines
	"bylines:read": Role.SUBSCRIBER,
	"bylines:manage": Role.EDITOR,

	// Widgets
	"widgets:read": Role.SUBSCRIBER,
	"widgets:manage": Role.EDITOR,

	// Sections
	"sections:read": Role.SUBSCRIBER,
	"sections:manage": Role.EDITOR,

	// Redirects
	"redirects:read": Role.EDITOR,
	"redirects:manage": Role.ADMIN,

	// Users
	"users:read": Role.ADMIN,
	"users:invite": Role.ADMIN,
	"users:manage": Role.ADMIN,

	// Settings
	"settings:read": Role.EDITOR,
	"settings:manage": Role.ADMIN,

	// Schema (content types)
	"schema:read": Role.EDITOR,
	"schema:manage": Role.ADMIN,

	// Plugins
	"plugins:read": Role.EDITOR,
	"plugins:manage": Role.ADMIN,

	// Import
	"import:execute": Role.ADMIN,

	// Backups (full content export — admin-only, same tier as settings:manage)
	"backups:manage": Role.ADMIN,

	// Site transfer (whole-site export, and import into an empty site)
	"transfer:export": Role.ADMIN,
	"transfer:import": Role.ADMIN,

	// Core update notice
	"updates:read": Role.ADMIN,

	// Search
	"search:read": Role.SUBSCRIBER,
	"search:manage": Role.ADMIN,

	// Auth
	"auth:manage_own_credentials": Role.SUBSCRIBER,
	"auth:manage_connections": Role.ADMIN,
} as const;

export type Permission = keyof typeof Permissions;

export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Object.keys loses the key type; the keys are Permission by construction
	Object.keys(Permissions) as Permission[],
);

export function isPermission(value: string): value is Permission {
	return Object.hasOwn(Permissions, value);
}

/**
 * Content permissions a custom role may hold for chosen collections only.
 * Every other permission is site-wide.
 */
export const COLLECTION_SCOPED_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
	"content:read",
	"content:read_drafts",
	"content:create",
	"content:edit_own",
	"content:edit_own_drafts",
	"content:edit_any",
	"content:delete_own",
	"content:delete_any",
	"content:delete_permanent",
	"content:publish_own",
	"content:publish_any",
]);

/**
 * Permissions that only the built-in Admin role holds. Each of them reaches
 * past the content model: who may sign in and how sign-in mail is delivered
 * (`users:*`, `auth:manage_connections`, `settings:manage` through the site
 * URL, `plugins:manage` through the email provider), the schema of every
 * collection, or the content of every collection at once (import, backups,
 * site transfer). A custom role cannot be granted them.
 */
export const BUILT_IN_ADMIN_ONLY_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
	"users:read",
	"users:invite",
	"users:manage",
	"auth:manage_connections",
	"settings:manage",
	"plugins:manage",
	"schema:manage",
	"import:execute",
	"backups:manage",
	"transfer:export",
	"transfer:import",
]);

/** Slugs of the five built-in roles; a custom role cannot take one. */
export const BUILT_IN_ROLE_SLUGS: ReadonlySet<string> = new Set([
	"admin",
	"editor",
	"author",
	"contributor",
	"subscriber",
]);

/**
 * Grants that include another: an `_any` permission includes its `_own`
 * counterpart, editing one's own entries includes editing one's own drafts,
 * and managing an area includes reading it, so a role that may manage menus
 * can open the Menus page that lists them. Applied in order, so a chain
 * needs its wider pair first.
 */
const IMPLIED_PERMISSIONS: ReadonlyArray<readonly [Permission, Permission]> = [
	["content:edit_any", "content:edit_own"],
	["content:edit_own", "content:edit_own_drafts"],
	["content:delete_any", "content:delete_own"],
	["content:publish_any", "content:publish_own"],
	["media:edit_any", "media:edit_own"],
	["media:delete_any", "media:delete_own"],
	["taxonomies:manage", "taxonomies:read"],
	["comments:moderate", "comments:read"],
	["menus:manage", "menus:read"],
	["bylines:manage", "bylines:read"],
	["widgets:manage", "widgets:read"],
	["sections:manage", "sections:read"],
	["redirects:manage", "redirects:read"],
	["search:manage", "search:read"],
];

/**
 * The permissions a custom role holds. `permissions` apply site-wide;
 * `collections` holds content permissions that apply only to the named
 * collection.
 */
export interface RoleGrants {
	permissions: Permission[];
	collections: Record<string, Permission[]>;
}

export interface CustomRole {
	id: string;
	slug: string;
	label: string;
	grants: RoleGrants;
}

/**
 * What a permission check receives. `role` is the built-in level. When
 * `customRole` is set, its grants decide and `role` only carries the
 * compatibility level for code that still compares numbers.
 */
export interface Actor {
	role: RoleLevel;
	customRole?: { grants: RoleGrants } | null;
}

export interface PermissionResource {
	/** Slug of the collection the operation targets. */
	collection?: string;
}

/**
 * Check if a user has a specific permission.
 *
 * A grant scoped to collections satisfies the check only when `resource`
 * names one of those collections. A check that names no collection is
 * satisfied only by a site-wide grant.
 */
export function hasPermission(
	user: Actor | null | undefined,
	permission: Permission,
	resource?: PermissionResource,
): boolean {
	if (!user) return false;
	const grants = user.customRole?.grants;
	if (!grants) return user.role >= Permissions[permission];
	if (grants.permissions.includes(permission)) return true;
	const collection = resource?.collection;
	if (collection === undefined || !Object.hasOwn(grants.collections, collection)) return false;
	return grants.collections[collection]?.includes(permission) ?? false;
}

/**
 * True when the user holds `permission` site-wide or for at least one
 * collection. For navigation and other places that ask "anywhere?", never
 * for authorizing an operation on a resource.
 */
export function hasPermissionInAnyCollection(
	user: Actor | null | undefined,
	permission: Permission,
): boolean {
	if (!user) return false;
	const grants = user.customRole?.grants;
	if (!grants) return user.role >= Permissions[permission];
	if (grants.permissions.includes(permission)) return true;
	return Object.values(grants.collections).some((scoped) => scoped.includes(permission));
}

/**
 * True when the user holds at least one content permission in `collection`.
 * Every built-in role passes, because each holds `content:read` everywhere.
 */
export function hasCollectionAccess(user: Actor | null | undefined, collection: string): boolean {
	for (const permission of COLLECTION_SCOPED_PERMISSIONS) {
		if (hasPermission(user, permission, { collection })) return true;
	}
	return false;
}

/**
 * The collections in which the user holds `permission`, or `null` when the
 * user holds it in every collection. Reads that cross collections (search,
 * dashboard, calendar) narrow their collection list with it.
 */
export function collectionsWithPermission(
	user: Actor | null | undefined,
	permission: Permission,
): string[] | null {
	if (!user) return [];
	const grants = user.customRole?.grants;
	if (!grants) return user.role >= Permissions[permission] ? null : [];
	if (grants.permissions.includes(permission)) return null;
	return Object.entries(grants.collections)
		.filter(([, scoped]) => scoped.includes(permission))
		.map(([collection]) => collection);
}

/**
 * Narrow a requested collection list (`undefined` meaning all) to the
 * collections in which the user holds `permission`. An empty result means
 * none: callers must not pass it on where an empty list means "all".
 */
export function narrowCollections(
	user: Actor | null | undefined,
	permission: Permission,
	requested: readonly string[] | undefined,
): string[] | undefined {
	const allowed = collectionsWithPermission(user, permission);
	if (allowed === null) return requested ? [...requested] : undefined;
	if (!requested || requested.length === 0) return allowed;
	return requested.filter((collection) => allowed.includes(collection));
}

/**
 * Require a permission, throwing if not met
 */
export function requirePermission(
	user: Actor | null | undefined,
	permission: Permission,
	resource?: PermissionResource,
): asserts user is Actor {
	if (!user) {
		throw new PermissionError("unauthorized", "Authentication required");
	}
	if (!hasPermission(user, permission, resource)) {
		throw new PermissionError("forbidden", `Missing permission: ${permission}`);
	}
}

/**
 * Check if user can perform action on a resource they own
 */
export function canActOnOwn(
	user: (Actor & { id: string }) | null | undefined,
	ownerId: string,
	ownPermission: Permission,
	anyPermission: Permission,
	resource?: PermissionResource,
): boolean {
	if (!user) return false;
	// Defense in depth: an empty-string ownerId means "no recorded owner"
	// (e.g. seed-imported content with `authorId: null` extracted to ""),
	// not "owned by an unauthenticated user". If both the user.id and the
	// ownerId are "", treating them as a match would accidentally grant
	// edit-own — fall through to the any-permission check instead.
	if (ownerId !== "" && user.id === ownerId) {
		return hasPermission(user, ownPermission, resource);
	}
	return hasPermission(user, anyPermission, resource);
}

/**
 * Require permission on a resource, checking ownership
 */
export function requirePermissionOnResource(
	user: (Actor & { id: string }) | null | undefined,
	ownerId: string,
	ownPermission: Permission,
	anyPermission: Permission,
	resource?: PermissionResource,
): asserts user is Actor & { id: string } {
	if (!user) {
		throw new PermissionError("unauthorized", "Authentication required");
	}
	if (!canActOnOwn(user, ownerId, ownPermission, anyPermission, resource)) {
		throw new PermissionError("forbidden", `Missing permission: ${anyPermission}`);
	}
}

/** The permissions a built-in role holds. */
export function permissionsForRole(role: RoleLevel): Permission[] {
	return ALL_PERMISSIONS.filter((permission) => role >= Permissions[permission]);
}

/**
 * The permissions a user holds: site-wide names and per-collection content
 * names. A built-in role holds everything site-wide.
 */
export function effectivePermissions(user: Actor): RoleGrants {
	const grants = user.customRole?.grants;
	if (!grants) return { permissions: permissionsForRole(user.role), collections: {} };
	return grants;
}

const COLLECTION_SLUG_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Bring stored or submitted grants into the shape checks rely on.
 *
 * Unknown names are dropped, as are names a custom role may not hold and
 * collection-scoped names that are not content permissions. Every `_any`
 * grant gains its `_own` counterpart in the same scope, and a scoped grant
 * that is also held site-wide is dropped from the scope.
 */
export function normalizeGrants(input: {
	permissions?: readonly string[];
	collections?: Readonly<Record<string, readonly string[]>>;
}): RoleGrants {
	const siteWide = withOwnCounterparts(
		(input.permissions ?? []).filter(
			(name): name is Permission =>
				isPermission(name) && !BUILT_IN_ADMIN_ONLY_PERMISSIONS.has(name),
		),
	);
	const collections: Record<string, Permission[]> = {};
	for (const [collection, names] of Object.entries(input.collections ?? {})) {
		if (!COLLECTION_SLUG_PATTERN.test(collection)) continue;
		const scoped = withOwnCounterparts(
			names.filter(
				(name): name is Permission => isPermission(name) && COLLECTION_SCOPED_PERMISSIONS.has(name),
			),
		).filter((name) => !siteWide.includes(name));
		if (scoped.length > 0) collections[collection] = scoped;
	}
	return { permissions: siteWide, collections };
}

function withOwnCounterparts(names: readonly Permission[]): Permission[] {
	const set = new Set(names);
	for (const [wider, included] of IMPLIED_PERMISSIONS) {
		if (set.has(wider)) set.add(included);
	}
	return ALL_PERMISSIONS.filter((permission) => set.has(permission));
}

const LEVELS_HIGH_TO_LOW: readonly RoleLevel[] = [
	Role.ADMIN,
	Role.EDITOR,
	Role.AUTHOR,
	Role.CONTRIBUTOR,
];

/**
 * The built-in level stored in `users.role` for a user with a custom role:
 * the highest built-in role whose permissions the custom role holds
 * site-wide. Code that compares role numbers then grants no more than the
 * custom role, except that the lowest storable level is Subscriber.
 */
export function compatibilityLevel(grants: RoleGrants): RoleLevel {
	const held = new Set(grants.permissions);
	for (const level of LEVELS_HIGH_TO_LOW) {
		if (permissionsForRole(level).every((permission) => held.has(permission))) return level;
	}
	return Role.SUBSCRIBER;
}

export class PermissionError extends Error {
	constructor(
		public code: "unauthorized" | "forbidden",
		message: string,
	) {
		super(message);
		this.name = "PermissionError";
	}
}

// ---------------------------------------------------------------------------
// API Token Scope ↔ Role mapping
//
// Maps each API token scope to the minimum RBAC role required to hold it.
// Used at token issuance time to clamp granted scopes to the user's role.
// ---------------------------------------------------------------------------

/**
 * Minimum role required for each API token scope.
 *
 * This is the authoritative mapping between the two authorization systems
 * (RBAC roles and API token scopes). When issuing a token, the granted
 * scopes must be intersected with the scopes allowed by the user's role.
 */
const SCOPE_MIN_ROLE: Record<Exclude<ApiTokenScope, `mcp:tools:${string}`>, RoleLevel> = {
	"content:read": Role.SUBSCRIBER,
	"content:write": Role.CONTRIBUTOR,
	"media:read": Role.SUBSCRIBER,
	"media:write": Role.CONTRIBUTOR,
	"schema:read": Role.EDITOR,
	"schema:write": Role.ADMIN,
	"taxonomies:manage": Role.EDITOR,
	"menus:manage": Role.EDITOR,
	"settings:read": Role.EDITOR,
	"settings:manage": Role.ADMIN,
	"mcp:tools": Role.ADMIN,
	"transfer:export": Role.ADMIN,
	"transfer:analyze": Role.ADMIN,
	"transfer:execute": Role.ADMIN,
	admin: Role.ADMIN,
};

/**
 * Return the maximum set of API token scopes a given role level may hold.
 *
 * Used at token issuance time (device flow, authorization code exchange)
 * to enforce: effective_scopes = requested_scopes ∩ scopesForRole(role).
 */
export function scopesForRole(role: RoleLevel): ApiTokenScope[] {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Object.entries loses tuple types; SCOPE_MIN_ROLE keys are ApiTokenScope by construction
	const entries = Object.entries(SCOPE_MIN_ROLE) as [ApiTokenScope, RoleLevel][];
	return entries.reduce<ApiTokenScope[]>((acc, [scope, minRole]) => {
		if (role >= minRole) acc.push(scope);
		return acc;
	}, []);
}

/**
 * Clamp a set of requested scopes to those permitted by a user's role.
 *
 * Returns the intersection of `requested` and the scopes the role allows.
 * This is the central policy enforcement point: effective permissions =
 * role permissions ∩ token scopes.
 */
export function clampScopes(requested: string[], role: RoleLevel): string[] {
	const allowed = new Set<string>(scopesForRole(role));
	return requested.filter(
		(scope) => allowed.has(scope) || (scope.startsWith("mcp:tools:") && role >= Role.SUBSCRIBER),
	);
}

/**
 * The permission a custom role must hold, site-wide or for at least one
 * collection, to receive each API token scope. `null` scopes are reserved
 * for built-in roles.
 */
const SCOPE_PERMISSION: Record<Exclude<ApiTokenScope, `mcp:tools:${string}`>, Permission | null> = {
	"content:read": "content:read",
	"content:write": "content:create",
	"media:read": "media:read",
	"media:write": "media:upload",
	"schema:read": "schema:read",
	"schema:write": "schema:manage",
	"taxonomies:manage": "taxonomies:manage",
	"menus:manage": "menus:manage",
	"settings:read": "settings:read",
	"settings:manage": "settings:manage",
	"mcp:tools": null,
	"transfer:export": "transfer:export",
	"transfer:analyze": "transfer:import",
	"transfer:execute": "transfer:import",
	admin: null,
};

/**
 * Like {@link scopesForRole}, for a user who may hold a custom role. A token
 * scope never widens what the role grants: checks still run against the
 * role's grants, including its collection scope.
 */
export function scopesForActor(actor: Actor): ApiTokenScope[] {
	if (!actor.customRole) return scopesForRole(actor.role);
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Object.entries loses tuple types; SCOPE_PERMISSION keys are ApiTokenScope by construction
	const entries = Object.entries(SCOPE_PERMISSION) as [ApiTokenScope, Permission | null][];
	return entries.reduce<ApiTokenScope[]>((acc, [scope, permission]) => {
		if (permission && hasPermissionInAnyCollection(actor, permission)) acc.push(scope);
		return acc;
	}, []);
}

/**
 * Accept either a bare built-in level or an actor, so a caller that only
 * knows the level keeps working while one that loaded the user passes it on.
 */
export function toActor(value: RoleLevel | Actor): Actor {
	return typeof value === "number" ? { role: value } : value;
}

/** Like {@link clampScopes}, for a user who may hold a custom role. */
export function clampScopesForActor(requested: string[], actor: Actor): string[] {
	if (!actor.customRole) return clampScopes(requested, actor.role);
	const allowed = new Set<string>(scopesForActor(actor));
	return requested.filter((scope) => allowed.has(scope) || scope.startsWith("mcp:tools:"));
}
