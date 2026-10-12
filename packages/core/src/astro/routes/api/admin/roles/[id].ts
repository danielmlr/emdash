/**
 * Custom role detail
 *
 * GET    /_emdash/api/admin/roles/:id - Get a custom role
 * PUT    /_emdash/api/admin/roles/:id - Update a custom role
 * DELETE /_emdash/api/admin/roles/:id - Delete an unassigned custom role
 */

import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";
import { handleRoleDelete, handleRoleGet, handleRoleUpdate } from "#api/handlers/roles.js";
import { isParseError, parseBody } from "#api/parse.js";
import { roleUpdateBody } from "#api/schemas.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);

	const denied = requirePerm(user, "users:read");
	if (denied) return denied;
	if (!params.id) return apiError("MISSING_PARAM", "Role ID required", 400);

	return unwrapResult(await handleRoleGet(emdash.db, params.id));
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);

	const denied = requirePerm(user, "users:manage");
	if (denied) return denied;
	if (!params.id) return apiError("MISSING_PARAM", "Role ID required", 400);

	const body = await parseBody(request, roleUpdateBody);
	if (isParseError(body)) return body;

	return unwrapResult(await handleRoleUpdate(emdash.db, params.id, body));
};

export const DELETE: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);

	const denied = requirePerm(user, "users:manage");
	if (denied) return denied;
	if (!params.id) return apiError("MISSING_PARAM", "Role ID required", 400);

	return unwrapResult(await handleRoleDelete(emdash.db, params.id));
};
