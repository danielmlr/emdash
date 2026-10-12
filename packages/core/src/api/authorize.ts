/**
 * Authorization helpers for API routes
 *
 * Thin wrappers around @emdash-cms/auth RBAC that return HTTP responses.
 * Auth middleware handles authentication; these handle authorization.
 */

import type { Actor, Permission, PermissionResource } from "@emdash-cms/auth";
import {
	hasCollectionAccess,
	hasPermission,
	hasPermissionInAnyCollection,
	canActOnOwn,
	hasScope,
} from "@emdash-cms/auth";

import { apiError } from "./error.js";

interface UserLike extends Actor {
	id: string;
}

export function canReadMediaUsageCount(
	user: UserLike | null | undefined,
	tokenScopes: string[] | undefined,
): boolean {
	return (
		hasPermission(user, "content:read_drafts") && (!tokenScopes || hasScope(tokenScopes, "admin"))
	);
}

/**
 * Check if user has a permission. Returns a 401/403 Response if not, or null if authorized.
 *
 * Content permissions name the collection the operation targets, so a role
 * scoped to some collections is checked against the right one.
 *
 * Usage:
 * ```ts
 * const denied = requirePerm(user, "schema:manage");
 * if (denied) return denied;
 * const denied = requirePerm(user, "content:create", { collection });
 * ```
 */
export function requirePerm(
	user: UserLike | null | undefined,
	permission: Permission,
	resource?: PermissionResource,
): Response | null {
	if (!user) {
		return apiError("UNAUTHORIZED", "Authentication required", 401);
	}
	if (!hasPermission(user, permission, resource)) {
		return apiError("FORBIDDEN", "Insufficient permissions", 403);
	}
	return null;
}

/**
 * Check if user can act on a resource, considering ownership.
 * Returns a 401/403 Response if not, or null if authorized.
 *
 * Usage:
 * ```ts
 * const denied = requireOwnerPerm(user, item.authorId, "content:edit_own", "content:edit_any");
 * if (denied) return denied;
 * ```
 */
export function requireOwnerPerm(
	user: UserLike | null | undefined,
	ownerId: string,
	ownPermission: Permission,
	anyPermission: Permission,
	resource?: PermissionResource,
): Response | null {
	if (!user) {
		return apiError("UNAUTHORIZED", "Authentication required", 401);
	}
	if (!canActOnOwn(user, ownerId, ownPermission, anyPermission, resource)) {
		return apiError("FORBIDDEN", "Insufficient permissions", 403);
	}
	return null;
}

/**
 * How `user` may edit an entry: `"full"` through `content:edit_own` or
 * `content:edit_any`, `"draft"` through `content:edit_own_drafts` only, or
 * `null` when they can't edit it.
 *
 * A `"draft"` grant holds only while the entry is still a draft, so the caller
 * must make its write fail if the entry changes after this check, for example
 * by conditioning the update on the `_rev` it checked.
 */
export function entryEditAccess(
	user: UserLike | null | undefined,
	entry: { authorId: string; status: unknown },
	resource?: PermissionResource,
): "full" | "draft" | null {
	if (canActOnOwn(user, entry.authorId, "content:edit_own", "content:edit_any", resource)) {
		return "full";
	}
	if (
		entry.status === "draft" &&
		canActOnOwn(user, entry.authorId, "content:edit_own_drafts", "content:edit_any", resource)
	) {
		return "draft";
	}
	return null;
}

/**
 * Check if user can edit an entry, including an owner editing their own draft
 * through `content:edit_own_drafts`. Returns a 401/403 Response if not, or null
 * if authorized. See {@link entryEditAccess} for what a draft-only grant requires
 * of the caller.
 */
export function requireEntryEditPerm(
	user: UserLike | null | undefined,
	entry: { authorId: string; status: unknown },
	resource?: PermissionResource,
): Response | null {
	if (!user) {
		return apiError("UNAUTHORIZED", "Authentication required", 401);
	}
	if (!entryEditAccess(user, entry, resource)) {
		return apiError("FORBIDDEN", "Insufficient permissions", 403);
	}
	return null;
}

/**
 * Like {@link requirePerm}, but authorized when the user has any of
 * `permissions`.
 */
export function requireAnyPerm(
	user: UserLike | null | undefined,
	permissions: readonly Permission[],
	resource?: PermissionResource,
): Response | null {
	if (!user) {
		return apiError("UNAUTHORIZED", "Authentication required", 401);
	}
	if (!permissions.some((permission) => hasPermission(user, permission, resource))) {
		return apiError("FORBIDDEN", "Insufficient permissions", 403);
	}
	return null;
}

/**
 * Pre-check for routes that learn the collection only after loading the
 * resource (revisions, cross-collection lists). Authorized when the user
 * holds `permission` site-wide or for at least one collection; the route
 * must still check the loaded resource's collection with {@link requirePerm}.
 */
export function requirePermInAnyCollection(
	user: UserLike | null | undefined,
	permission: Permission,
): Response | null {
	if (!user) {
		return apiError("UNAUTHORIZED", "Authentication required", 401);
	}
	if (!hasPermissionInAnyCollection(user, permission)) {
		return apiError("FORBIDDEN", "Insufficient permissions", 403);
	}
	return null;
}

/**
 * Deny before a route loads anything when the user holds no content
 * permission in `collection`, so a role limited to other collections cannot
 * learn which entries exist there from a 404. Every built-in role passes.
 * A missing user is left to the route's own checks, which order the
 * not-configured and unauthenticated answers.
 */
export function requireCollectionAccess(
	user: UserLike | null | undefined,
	collection: string | undefined,
): Response | null {
	if (!user) return null;
	if (!collection || !hasCollectionAccess(user, collection)) {
		return apiError("FORBIDDEN", "Insufficient permissions", 403);
	}
	return null;
}
