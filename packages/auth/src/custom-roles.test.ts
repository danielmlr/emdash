import { describe, expect, it } from "vitest";

import {
	ALL_PERMISSIONS,
	BUILT_IN_ADMIN_ONLY_PERMISSIONS,
	canActOnOwn,
	clampScopesForActor,
	compatibilityLevel,
	hasPermission,
	hasPermissionInAnyCollection,
	normalizeGrants,
	permissionsForRole,
	scopesForActor,
	scopesForRole,
	type Actor,
	type RoleGrants,
} from "./rbac.js";
import { Role, type RoleLevel } from "./types.js";

function customActor(grants: RoleGrants, id = "user-1"): Actor & { id: string } {
	return { id, role: compatibilityLevel(grants), customRole: { grants } };
}

const jobsEditor = normalizeGrants({
	permissions: ["media:read", "media:upload", "taxonomies:read"],
	collections: {
		jobs: [
			"content:read",
			"content:read_drafts",
			"content:create",
			"content:edit_any",
			"content:delete_any",
			"content:publish_any",
		],
	},
});

const BUILT_IN_BELOW_ADMIN: RoleLevel[] = [
	Role.SUBSCRIBER,
	Role.CONTRIBUTOR,
	Role.AUTHOR,
	Role.EDITOR,
];

describe("custom roles", () => {
	describe("a custom role holding a built-in role's permissions", () => {
		it.each(BUILT_IN_BELOW_ADMIN)(
			"answers every check like built-in role %s, in every collection",
			(level) => {
				const builtIn = { role: level };
				const custom = customActor(normalizeGrants({ permissions: permissionsForRole(level) }));
				for (const permission of ALL_PERMISSIONS) {
					const expected = hasPermission(builtIn, permission);
					expect(hasPermission(custom, permission), permission).toBe(expected);
					expect(hasPermission(custom, permission, { collection: "posts" }), permission).toBe(
						expected,
					);
				}
			},
		);

		it.each(BUILT_IN_BELOW_ADMIN)("is stored at the built-in level %s", (level) => {
			expect(compatibilityLevel(normalizeGrants({ permissions: permissionsForRole(level) }))).toBe(
				level,
			);
		});

		it("cannot copy the Admin role: user and connection management stay built-in", () => {
			const grants = normalizeGrants({ permissions: permissionsForRole(Role.ADMIN) });
			for (const permission of BUILT_IN_ADMIN_ONLY_PERMISSIONS) {
				expect(grants.permissions).not.toContain(permission);
			}
			expect(compatibilityLevel(grants)).toBe(Role.EDITOR);
		});
	});

	describe("collection scope", () => {
		const sam = customActor(jobsEditor);

		it("grants scoped content permissions in the named collection only", () => {
			expect(hasPermission(sam, "content:edit_any", { collection: "jobs" })).toBe(true);
			expect(hasPermission(sam, "content:publish_any", { collection: "jobs" })).toBe(true);
			expect(hasPermission(sam, "content:edit_any", { collection: "posts" })).toBe(false);
			expect(hasPermission(sam, "content:read", { collection: "posts" })).toBe(false);
		});

		it("denies a scoped permission when the check names no collection", () => {
			expect(hasPermission(sam, "content:read")).toBe(false);
			expect(hasPermission(sam, "content:create")).toBe(false);
		});

		it("applies site-wide grants everywhere", () => {
			expect(hasPermission(sam, "media:upload")).toBe(true);
			expect(hasPermission(sam, "media:upload", { collection: "posts" })).toBe(true);
		});

		it("adds the _own counterpart of every _any grant in the same scope", () => {
			expect(
				canActOnOwn(sam, sam.id, "content:edit_own", "content:edit_any", { collection: "jobs" }),
			).toBe(true);
			expect(
				canActOnOwn(sam, sam.id, "content:edit_own", "content:edit_any", { collection: "posts" }),
			).toBe(false);
		});

		it("does not treat inherited object keys as collections", () => {
			expect(hasPermission(sam, "content:read", { collection: "constructor" })).toBe(false);
			expect(hasPermission(sam, "content:read", { collection: "toString" })).toBe(false);
		});

		it("answers 'anywhere' questions for navigation", () => {
			expect(hasPermissionInAnyCollection(sam, "content:create")).toBe(true);
			expect(hasPermissionInAnyCollection(sam, "menus:manage")).toBe(false);
		});
	});

	describe("failing closed", () => {
		it("ignores the stored level once a custom role is attached", () => {
			const empty: Actor = {
				role: Role.ADMIN,
				customRole: { grants: { permissions: [], collections: {} } },
			};
			for (const permission of ALL_PERMISSIONS) {
				expect(hasPermission(empty, permission, { collection: "posts" }), permission).toBe(false);
			}
		});

		it("drops unknown names, admin-only names and non-content names in a scope", () => {
			const grants = normalizeGrants({
				permissions: ["content:read", "not:a_permission", "users:manage"],
				collections: {
					jobs: ["content:edit_any", "menus:manage", "nope"],
					"Bad-Slug": ["content:read"],
				},
			});
			expect(grants.permissions).toEqual(["content:read"]);
			expect(grants.collections).toEqual({ jobs: ["content:edit_own", "content:edit_any"] });
		});

		it("drops a scoped grant the role already holds site-wide", () => {
			const grants = normalizeGrants({
				permissions: ["content:read"],
				collections: { jobs: ["content:read", "content:create"] },
			});
			expect(grants.collections).toEqual({ jobs: ["content:create"] });
		});
	});

	describe("compatibility level", () => {
		it("is Author for Editor permissions without menus:manage", () => {
			const editorWithoutMenus = permissionsForRole(Role.EDITOR).filter(
				(p) => p !== "menus:manage",
			);
			expect(compatibilityLevel(normalizeGrants({ permissions: editorWithoutMenus }))).toBe(
				Role.AUTHOR,
			);
		});

		it("floors at Subscriber for a role narrower than every built-in role", () => {
			expect(compatibilityLevel(jobsEditor)).toBe(Role.SUBSCRIBER);
		});

		it("never counts collection-scoped grants", () => {
			const contributorInJobsOnly = normalizeGrants({
				permissions: permissionsForRole(Role.SUBSCRIBER),
				collections: { jobs: permissionsForRole(Role.EDITOR) },
			});
			expect(compatibilityLevel(contributorInJobsOnly)).toBe(Role.SUBSCRIBER);
		});
	});

	describe("token scopes", () => {
		it("keeps the built-in mapping for built-in roles", () => {
			for (const level of [...BUILT_IN_BELOW_ADMIN, Role.ADMIN]) {
				expect(scopesForActor({ role: level })).toEqual(scopesForRole(level));
			}
		});

		it("derives scopes from grants for a custom role", () => {
			const scopes = scopesForActor(customActor(jobsEditor));
			expect(scopes).toContain("content:read");
			expect(scopes).toContain("content:write");
			expect(scopes).toContain("media:write");
			expect(scopes).not.toContain("schema:read");
			expect(scopes).not.toContain("admin");
		});

		it("clamps requested scopes for a custom role", () => {
			expect(
				clampScopesForActor(["content:read", "admin", "mcp:tools:forms"], customActor(jobsEditor)),
			).toEqual(["content:read", "mcp:tools:forms"]);
		});
	});
});
