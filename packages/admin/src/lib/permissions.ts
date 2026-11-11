/**
 * Permission checks in the admin, answered from the permission names that
 * GET /_emdash/api/auth/me returns. The server checks every request; these
 * only decide what the admin offers.
 */

import * as React from "react";

import { useCurrentUser, type CurrentUser } from "./api/current-user.js";

type PermissionHolder = Pick<CurrentUser, "permissions"> | null | undefined;

export function can(user: PermissionHolder, permission: string): boolean {
	return user?.permissions?.includes(permission) ?? false;
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
): boolean {
	if (ownerId && user?.id === ownerId) return can(user, ownPermission);
	return can(user, anyPermission);
}

export interface PermissionChecks {
	can: (permission: string) => boolean;
	canActOnOwn: (
		ownerId: string | null | undefined,
		ownPermission: string,
		anyPermission: string,
	) => boolean;
}

/** Permission checks bound to the signed-in user. */
export function useCan(): PermissionChecks {
	const { data: user } = useCurrentUser();
	return React.useMemo(
		() => ({
			can: (permission) => can(user, permission),
			canActOnOwn: (ownerId, ownPermission, anyPermission) =>
				canActOnOwn(user, ownerId, ownPermission, anyPermission),
		}),
		[user],
	);
}
