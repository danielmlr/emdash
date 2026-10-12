/**
 * Shared user lookup for OAuth token operations.
 *
 * Loads the user's current role, custom role and disabled status through the
 * auth adapter, one query with the role join. Used by handleTokenRefresh()
 * and the authorization-code exchange to revalidate scopes against the
 * user's current grants and reject disabled users.
 */

import type { Actor } from "@emdash-cms/auth";
import { createKyselyAdapter, type AuthTables } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";

import type { Database } from "../../database/types.js";

export interface UserRoleAndStatus extends Actor {
	disabled: boolean;
}

/**
 * Look up a user's current role, custom role and disabled status.
 * Returns null if the user doesn't exist.
 */
export async function lookupUserRoleAndStatus(
	db: Kysely<Database>,
	userId: string,
): Promise<UserRoleAndStatus | null> {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the core schema carries every auth table
	const user = await createKyselyAdapter(db as unknown as Kysely<AuthTables>).getUserById(userId);
	if (!user) return null;
	return { role: user.role, customRole: user.customRole ?? null, disabled: user.disabled };
}
