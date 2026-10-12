/**
 * User management detail endpoint
 *
 * GET /_emdash/api/admin/users/:id - Get user details
 * PUT /_emdash/api/admin/users/:id - Update user
 */

import { Role } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError } from "#api/error.js";
import { findRoleForAssignment } from "#api/handlers/roles.js";
import { isParseError, parseBody } from "#api/parse.js";
import { userUpdateBody } from "#api/schemas.js";
import { withTransaction } from "#db/transaction.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	const { emdash, user: currentUser } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(currentUser, "users:read");
	if (denied) return denied;

	const adapter = createKyselyAdapter(emdash.db);

	const { id } = params;

	if (!id) {
		return apiError("MISSING_PARAM", "User ID required", 400);
	}

	try {
		const result = await adapter.getUserWithDetails(id);

		if (!result) {
			return apiError("NOT_FOUND", "User not found", 404);
		}

		// Transform for JSON serialization
		const item = {
			id: result.user.id,
			email: result.user.email,
			name: result.user.name,
			avatarUrl: result.user.avatarUrl,
			role: result.user.role,
			customRole: summarizeCustomRole(result.user.customRole),
			emailVerified: result.user.emailVerified,
			disabled: result.user.disabled,
			createdAt: result.user.createdAt.toISOString(),
			updatedAt: result.user.updatedAt.toISOString(),
			lastLogin: result.lastLogin?.toISOString() ?? null,
			credentials: result.credentials.map((c) => ({
				id: c.id,
				name: c.name,
				deviceType: c.deviceType,
				createdAt: c.createdAt.toISOString(),
				lastUsedAt: c.lastUsedAt.toISOString(),
			})),
			oauthAccounts: result.oauthAccounts.map((a) => ({
				provider: a.provider,
				createdAt: a.createdAt.toISOString(),
			})),
		};

		return apiSuccess({ item });
	} catch (error) {
		return handleError(error, "Failed to get user details", "USER_DETAIL_ERROR");
	}
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user: currentUser } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(currentUser, "users:manage");
	if (denied) return denied;

	const adapter = createKyselyAdapter(emdash.db);

	const { id } = params;

	if (!id) {
		return apiError("MISSING_PARAM", "User ID required", 400);
	}

	try {
		// Get target user
		const targetUser = await adapter.getUserById(id);
		if (!targetUser) {
			return apiError("NOT_FOUND", "User not found", 404);
		}

		const body = await parseBody(request, userUpdateBody);
		if (isParseError(body)) return body;

		// A built-in level clears any custom role; a custom role stores its
		// compatibility level in `role`.
		let role = body.role;
		let roleId: string | null | undefined = body.role === undefined ? undefined : null;
		if (body.roleId !== undefined) {
			const customRole = await findRoleForAssignment(emdash.db, body.roleId);
			if (!customRole) return apiError("VALIDATION_ERROR", "Unknown role", 400);
			role = customRole.level;
			roleId = customRole.id;
		}

		// Prevent editing own role (security: prevents self-demotion/lockout)
		if (role !== undefined && id === currentUser!.id) {
			return apiError("SELF_ROLE_CHANGE", "Cannot change your own role", 400);
		}

		// Check email uniqueness if changing email
		if (body.email && body.email !== targetUser.email) {
			const existing = await adapter.getUserByEmail(body.email);
			if (existing) {
				return apiError("EMAIL_IN_USE", "Email already in use", 409);
			}
		}

		// Wrap admin demotion guard + update in a transaction to prevent
		// two concurrent demotions from both passing the count check.
		const isDemotingAdmin =
			role !== undefined && role < Role.ADMIN && targetUser.role === Role.ADMIN;

		const blocked = await withTransaction(
			emdash.db,
			async (trx): Promise<"last-admin" | "unknown-role" | null> => {
				const trxAdapter = createKyselyAdapter(trx);
				if (isDemotingAdmin) {
					const adminCount = await trxAdapter.countAdmins();
					if (adminCount <= 1) return "last-admin";
				}
				// The level is read again here, inside the write, so a role edit
				// that commits between the check above and this write cannot leave
				// the user at a level the role no longer holds.
				let level = role;
				if (roleId) {
					const current = await findRoleForAssignment(trx, roleId, { forUpdate: true });
					if (!current) return "unknown-role";
					level = current.level;
				}
				await trxAdapter.updateUser(id, {
					name: body.name,
					email: body.email,
					role: level,
					roleId,
				});
				return null;
			},
		);

		if (blocked === "last-admin") {
			return apiError(
				"LAST_ADMIN",
				"Cannot demote the last admin. Promote another user first.",
				400,
			);
		}
		if (blocked === "unknown-role") return apiError("VALIDATION_ERROR", "Unknown role", 400);

		// Fetch updated user
		const updated = await adapter.getUserById(id);

		return apiSuccess({
			item: {
				id: updated!.id,
				email: updated!.email,
				name: updated!.name,
				avatarUrl: updated!.avatarUrl,
				role: updated!.role,
				customRole: summarizeCustomRole(updated!.customRole),
				emailVerified: updated!.emailVerified,
				disabled: updated!.disabled,
				createdAt: updated!.createdAt.toISOString(),
				updatedAt: updated!.updatedAt.toISOString(),
			},
		});
	} catch (error) {
		return handleError(error, "Failed to update user", "USER_UPDATE_ERROR");
	}
};

function summarizeCustomRole(
	customRole: { id: string; slug: string; label: string } | null | undefined,
): { id: string; slug: string; label: string } | null {
	return customRole ? { id: customRole.id, slug: customRole.slug, label: customRole.label } : null;
}
