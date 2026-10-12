/**
 * Search endpoint - Full-text search across collections
 *
 * GET /_emdash/api/search?q=query&collections=posts,pages&limit=20
 */

import { collectionsWithPermission } from "@emdash-cms/auth";
import type { APIRoute } from "astro";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseQuery } from "#api/parse.js";
import { searchQuery } from "#api/schemas.js";
import { searchWithDb } from "#search/index.js";

export const prerender = false;

/**
 * Search content
 *
 * Query parameters:
 * - q: Search query (required)
 * - collections: Comma-separated list of collection slugs (optional, defaults to all)
 * - status: Filter by status (optional, defaults to 'published')
 * - limit: Maximum results (optional, defaults to 20)
 */
export const GET: APIRoute = async ({ url, locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash not configured", 500);
	}

	const query = parseQuery(url, searchQuery);
	if (isParseError(query)) return query;

	const collections = query.collections
		? query.collections.split(",").map((c: string) => c.trim())
		: undefined;

	// Only users with content:read_drafts may search non-published statuses,
	// and only in the collections where they hold it. Anonymous and
	// subscriber requests are forced to "published".
	let status = "published";
	let searchCollections = collections;
	if (query.status && query.status !== "published") {
		const draftCollections = collectionsWithPermission(user, "content:read_drafts");
		if (draftCollections === null) {
			status = query.status;
		} else {
			const narrowed = (collections ?? draftCollections).filter((collection) =>
				draftCollections.includes(collection),
			);
			if (narrowed.length > 0) {
				status = query.status;
				searchCollections = narrowed;
			}
		}
	}

	try {
		// Verify FTS indexes are healthy on first use. At most once per worker
		// lifetime; no-op after that. Moved off the cold-start hot path to
		// keep anonymous public reads fast.
		await emdash.ensureSearchHealthy?.();

		const result = await searchWithDb(emdash.db, query.q, {
			collections: searchCollections,
			status,
			locale: query.locale,
			limit: query.limit,
			cursor: query.cursor,
			scope: query.scope,
		});

		return apiSuccess(result);
	} catch (error) {
		// handleError maps a malformed pagination cursor to a 400 INVALID_CURSOR.
		return handleError(error, "Search failed", "SEARCH_ERROR");
	}
};
