/**
 * Content list and create endpoints - injected by EmDash integration
 *
 * GET  /_emdash/api/content/{collection} - List content
 * POST /_emdash/api/content/{collection} - Create content
 */

import { hasPermission } from "@emdash-cms/auth";
import type { APIRoute } from "astro";

import { requirePerm, requireOwnerPerm, requireCollectionAccess } from "#api/authorize.js";
import { apiError, mapErrorStatus, unwrapResult } from "#api/error.js";
import { parseBody, parseQuery, isParseError } from "#api/parse.js";
import { contentListQuery, contentCreateBody } from "#api/schemas.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, url, locals }) => {
	const { emdash, user } = locals;
	const collectionDenied = requireCollectionAccess(user, params.collection);
	if (collectionDenied) return collectionDenied;
	if (!emdash?.handleContentList) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:read", { collection: params.collection });
	if (denied) return denied;
	const collection = params.collection!;
	const query = parseQuery(url, contentListQuery);
	if (isParseError(query)) return query;

	// Subscribers must only see published content; force the status filter
	// regardless of caller-supplied value. Any user with content:read_drafts
	// (CONTRIBUTOR+) keeps the requested filter.
	const params_ = hasPermission(user, "content:read_drafts", { collection: params.collection })
		? query
		: { ...query, status: "published" };

	const result = await emdash.handleContentList(collection, params_);

	return unwrapResult(result);
};

export const POST: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;
	const collectionDenied = requireCollectionAccess(user, params.collection);
	if (collectionDenied) return collectionDenied;
	if (!emdash?.handleContentCreate || !emdash?.handleContentGet) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:create", { collection: params.collection });
	if (denied) return denied;
	const collection = params.collection!;
	const body = await parseBody(request, contentCreateBody);
	if (isParseError(body)) return body;

	// Creating a translation requires edit permission on the source item
	if (body.translationOf) {
		const source = await emdash.handleContentGet(collection, body.translationOf);
		if (!source.success) {
			return apiError(
				source.error?.code ?? "NOT_FOUND",
				source.error?.message ?? "Translation source not found",
				mapErrorStatus(source.error?.code),
			);
		}
		const sourceAuthor = source.data.item.authorId ?? "";
		const translationDenied = requireOwnerPerm(
			user,
			sourceAuthor,
			"content:edit_own",
			"content:edit_any",
			{ collection },
		);
		if (translationDenied) return translationDenied;
	}

	// Only EDITOR+ can write publishedAt / createdAt directly — incl. clearing to null.
	const hasDateOverride = body.publishedAt !== undefined || body.createdAt !== undefined;
	if (
		hasDateOverride &&
		!hasPermission(user, "content:publish_any", { collection: params.collection })
	) {
		return apiError(
			"FORBIDDEN",
			"Writing publishedAt or createdAt requires content:publish_any permission",
			403,
		);
	}

	const actor = user ? { id: user.id, role: user.role } : undefined;

	// Auto-set authorId to current user when creating content
	const result = await emdash.handleContentCreate(collection, {
		...body,
		authorId: user?.id,
		locale: body.locale,
		translationOf: body.translationOf,
		actor,
		referenceAccess: {
			canLink: (target) => hasPermission(user, "content:read", { collection: target }),
		},
	});

	return unwrapResult(result, 201);
};
