/**
 * Users as GET /auth/me describes them, built from the server's own
 * permission map so admin tests follow it.
 */

import { normalizeGrants, permissionsForRole } from "@emdash-cms/auth/rbac";

import type { CurrentUser } from "../../src/lib/api/current-user";
import { can, canAnywhere, type PermissionChecks } from "../../src/lib/permissions";

export function builtInUser(level: 10 | 20 | 30 | 40 | 50, id = "user-1"): CurrentUser {
	return {
		id,
		email: `${id}@example.com`,
		role: level,
		customRole: null,
		permissions: permissionsForRole(level),
		collections: {},
	};
}

export function customRoleUser(
	grants: { permissions?: string[]; collections?: Record<string, string[]> },
	id = "user-1",
): CurrentUser {
	const normalized = normalizeGrants(grants);
	return {
		id,
		email: `${id}@example.com`,
		role: 10,
		customRole: { id: "role-1", slug: "custom", label: "Custom" },
		permissions: normalized.permissions,
		collections: normalized.collections,
	};
}

export function checksFor(user: CurrentUser): Pick<PermissionChecks, "can" | "canAnywhere"> {
	return {
		can: (permission, resource) => can(user, permission, resource),
		canAnywhere: (permission) => canAnywhere(user, permission),
	};
}
