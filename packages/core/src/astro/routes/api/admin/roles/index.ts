/**
 * Custom roles
 *
 * GET  /_emdash/api/admin/roles - List custom roles and the permission catalog
 * POST /_emdash/api/admin/roles - Create a custom role
 */

import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";
import { handleRoleCreate, handleRoleList } from "#api/handlers/roles.js";
import { isParseError, parseBody } from "#api/parse.js";
import { roleCreateBody } from "#api/schemas.js";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	const { emdash, user } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);

	const denied = requirePerm(user, "users:read");
	if (denied) return denied;

	return unwrapResult(await handleRoleList(emdash.db));
};

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);

	const denied = requirePerm(user, "users:manage");
	if (denied) return denied;

	const body = await parseBody(request, roleCreateBody);
	if (isParseError(body)) return body;

	return unwrapResult(await handleRoleCreate(emdash.db, body), 201);
};
