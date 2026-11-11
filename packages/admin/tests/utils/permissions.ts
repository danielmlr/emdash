// Import source (not package `dist`) so fixtures track edits without a prior `auth` build.
import { permissionsForRole } from "../../../auth/src/rbac.js";
import { toRoleLevel } from "../../../auth/src/types.js";

/** The `permissions` that `/auth/me` returns for a built-in role level. */
export function permissionsFor(role: number): string[] {
	return permissionsForRole(toRoleLevel(role));
}
