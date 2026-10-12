/**
 * Dashboard stats endpoint
 *
 * GET /_emdash/api/dashboard - Collection counts, media/user counts, recent items
 */

import { collectionsWithPermission } from "@emdash-cms/auth";
import type { APIRoute } from "astro";

import { requirePermInAnyCollection } from "#api/authorize.js";
import { apiError, handleError, unwrapResult } from "#api/error.js";
import { handleDashboardStats } from "#api/handlers/dashboard.js";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	const { emdash, user } = locals;

	const denied = requirePermInAnyCollection(user, "content:read");
	if (denied) return denied;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	try {
		const drafts = collectionsWithPermission(user, "content:read_drafts");
		const result = await handleDashboardStats(emdash.db, {
			includeDrafts: drafts ?? true,
			readableCollections: collectionsWithPermission(user, "content:read"),
		});

		return unwrapResult(result);
	} catch (error) {
		return handleError(error, "Failed to load dashboard", "DASHBOARD_ERROR");
	}
};
