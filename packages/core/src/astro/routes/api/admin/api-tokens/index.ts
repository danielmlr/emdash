/**
 * API token management endpoints
 *
 * GET  /_emdash/api/admin/api-tokens — List tokens for current user
 * POST /_emdash/api/admin/api-tokens — Create a new token
 */

import type { APIRoute } from "astro";
import { z } from "zod";

import { requirePerm } from "#api/authorize.js";
import { apiError, handleError, unwrapResult } from "#api/error.js";
import { handleApiTokenCreate, handleApiTokenList } from "#api/handlers/api-tokens.js";
import { isParseError, parseBody } from "#api/parse.js";
import { isValidScope } from "#auth/api-tokens.js";

export const prerender = false;

const createTokenSchema = z.object({
	name: z.string().min(1).max(100),
	scopes: z.array(z.string().refine(isValidScope)).min(1),
	expiresAt: z.iso
		.datetime()
		.or(z.iso.datetime({ precision: -1 }))
		.optional(),
});

/**
 * List API tokens for the current user.
 * Admins can list all tokens (future: add ?userId= filter).
 */
export const GET: APIRoute = async ({ locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "auth:manage_api_tokens");
	if (denied) return denied;

	const result = await handleApiTokenList(emdash.db, user.id);
	return unwrapResult(result);
};

/**
 * Create a new API token.
 * Returns the raw token once — it cannot be retrieved again.
 */
export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "auth:manage_api_tokens");
	if (denied) return denied;

	try {
		const body = await parseBody(request, createTokenSchema);
		if (isParseError(body)) return body;

		const result = await handleApiTokenCreate(emdash.db, user.id, body);
		return unwrapResult(result, 201);
	} catch (error) {
		return handleError(error, "Failed to create API token", "TOKEN_CREATE_ERROR");
	}
};
