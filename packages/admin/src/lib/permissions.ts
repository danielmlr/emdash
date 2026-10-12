/**
 * Permission checks in the admin, answered from the effective permissions
 * that GET /_emdash/api/auth/me returns. The server checks every request;
 * these only decide what the admin offers.
 */

import * as React from "react";

import { useCurrentUser, type CurrentUser } from "./api/current-user.js";

export interface PermissionResource {
	/** Slug of the collection the action targets. */
	collection?: string;
}

type PermissionHolder = Pick<CurrentUser, "permissions" | "collections"> | null | undefined;

/**
 * Whether the user holds `permission`. A permission held for some
 * collections counts only when `resource` names one of them.
 */
export function can(
	user: PermissionHolder,
	permission: string,
	resource?: PermissionResource,
): boolean {
	if (!user) return false;
	if (user.permissions?.includes(permission)) return true;
	const collection = resource?.collection;
	if (!collection || !user.collections || !Object.hasOwn(user.collections, collection)) {
		return false;
	}
	return user.collections[collection]?.includes(permission) ?? false;
}

/** Whether the user holds `permission` everywhere or in at least one collection. */
export function canAnywhere(user: PermissionHolder, permission: string): boolean {
	if (!user) return false;
	if (user.permissions?.includes(permission)) return true;
	return Object.values(user.collections ?? {}).some((names) => names.includes(permission));
}

/**
 * Ownership-aware check matching the server's own/any pairs. An empty owner
 * id matches nobody, so only the `any` permission applies.
 */
export function canActOnOwn(
	user: (PermissionHolder & { id?: string }) | null | undefined,
	ownerId: string | null | undefined,
	ownPermission: string,
	anyPermission: string,
	resource?: PermissionResource,
): boolean {
	if (!user) return false;
	if (ownerId && user.id === ownerId) return can(user, ownPermission, resource);
	return can(user, anyPermission, resource);
}

export interface PermissionChecks {
	user: CurrentUser | undefined;
	can: (permission: string, resource?: PermissionResource) => boolean;
	canAnywhere: (permission: string) => boolean;
	canActOnOwn: (
		ownerId: string | null | undefined,
		ownPermission: string,
		anyPermission: string,
		resource?: PermissionResource,
	) => boolean;
}

/** Permission checks bound to the signed-in user. */
export function useCan(): PermissionChecks {
	const { data: user } = useCurrentUser();
	return React.useMemo(
		() => ({
			user,
			can: (permission, resource) => can(user, permission, resource),
			canAnywhere: (permission) => canAnywhere(user, permission),
			canActOnOwn: (ownerId, ownPermission, anyPermission, resource) =>
				canActOnOwn(user, ownerId, ownPermission, anyPermission, resource),
		}),
		[user],
	);
}
