/**
 * Single revision endpoint - injected by EmDash integration
 *
 * GET  /_emdash/api/revisions/{revisionId} - Get revision details
 * POST /_emdash/api/revisions/{revisionId}/restore - Restore revision
 */

import { hasPermission } from "@emdash-cms/auth";
import type { APIRoute } from "astro";

import { requirePermInAnyCollection } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const revisionId = params.revisionId!;

	const denied = requirePermInAnyCollection(user, "content:read_drafts");
	if (denied) return denied;

	if (!emdash?.handleRevisionGet) {
		return apiError("NOT_CONFIGURED", "EmDash not configured", 500);
	}

	const result = await emdash.handleRevisionGet(revisionId);
	// A revision in a collection the caller may not read drafts of is answered
	// like a missing one, so revision ids cannot be probed across collections.
	if (
		result.success &&
		!hasPermission(user, "content:read_drafts", { collection: result.data?.item?.collection })
	) {
		return apiError("NOT_FOUND", `Revision not found: ${revisionId}`, 404);
	}

	return unwrapResult(result);
};
