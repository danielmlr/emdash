/**
 * Single API token endpoint
 *
 * DELETE /_emdash/api/admin/api-tokens/:id — Revoke a token
 */

import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, handleError, unwrapResult } from "#api/error.js";
import { handleApiTokenRevoke } from "#api/handlers/api-tokens.js";

export const prerender = false;

/**
 * Revoke (delete) an API token.
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "auth:manage_api_tokens");
	if (denied) return denied;

	const tokenId = params.id;
	if (!tokenId) {
		return apiError("VALIDATION_ERROR", "Token ID is required", 400);
	}

	try {
		const result = await handleApiTokenRevoke(emdash.db, tokenId, user.id);
		return unwrapResult(result);
	} catch (error) {
		return handleError(error, "Failed to revoke API token", "TOKEN_REVOKE_ERROR");
	}
};
