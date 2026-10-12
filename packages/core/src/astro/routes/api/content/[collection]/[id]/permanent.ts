/**
 * Permanent delete content endpoint - injected by EmDash integration
 *
 * DELETE /_emdash/api/content/{collection}/{id}/permanent - Permanently delete (no undo)
 */

import type { APIRoute } from "astro";

import { requirePerm, requireCollectionAccess } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";
import { invalidateRouteCache } from "#cache/route-cache.js";

export const prerender = false;

export const DELETE: APIRoute = async ({ params, locals, cache }) => {
	const { emdash, user } = locals;
	const collectionDenied = requireCollectionAccess(user, params.collection);
	if (collectionDenied) return collectionDenied;
	const collection = params.collection!;
	const id = params.id!;

	if (!emdash?.handleContentPermanentDelete) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:delete_permanent", { collection: params.collection });
	if (denied) return denied;

	const result = await emdash.handleContentPermanentDelete(collection, id);

	if (!result.success) return unwrapResult(result);

	await invalidateRouteCache(cache, [collection, id]);

	return unwrapResult(result);
};
