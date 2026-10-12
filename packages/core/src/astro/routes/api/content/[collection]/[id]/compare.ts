/**
 * Compare live and draft revisions
 *
 * GET /_emdash/api/content/{collection}/{id}/compare
 */

import type { APIRoute } from "astro";

import { requirePerm, requireCollectionAccess } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const collectionDenied = requireCollectionAccess(user, params.collection);
	if (collectionDenied) return collectionDenied;
	if (!emdash?.handleContentCompare) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:read_drafts", { collection: params.collection });
	if (denied) return denied;
	const collection = params.collection!;
	const id = params.id!;

	const result = await emdash.handleContentCompare(collection, id);

	return unwrapResult(result);
};
