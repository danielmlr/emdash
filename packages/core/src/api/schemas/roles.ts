import { BUILT_IN_ROLE_SLUGS } from "@emdash-cms/auth";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Admin / Roles: Input schemas
// ---------------------------------------------------------------------------

const ROLE_SLUG_PATTERN = /^[a-z][a-z0-9_-]*$/;
const COLLECTION_SLUG_PATTERN = /^[a-z][a-z0-9_]*$/;

const permissionNames = z.array(z.string().min(1).max(64)).max(200);

export const roleCreateBody = z
	.object({
		slug: z
			.string()
			.min(1)
			.max(63)
			.regex(ROLE_SLUG_PATTERN, {
				message: "Slug must start with a letter and contain only a-z, 0-9, - and _",
			})
			.refine((slug) => !BUILT_IN_ROLE_SLUGS.has(slug), {
				message: "Slug names a built-in role",
			}),
		label: z.string().trim().min(1).max(100),
		description: z.string().trim().max(500).nullable().optional(),
		permissions: permissionNames.default([]),
		collections: z
			.record(z.string().max(63).regex(COLLECTION_SLUG_PATTERN), permissionNames)
			.default({}),
	})
	.meta({ id: "RoleCreateBody" });

export const roleUpdateBody = z
	.object({
		label: z.string().trim().min(1).max(100).optional(),
		description: z.string().trim().max(500).nullable().optional(),
		permissions: permissionNames.optional(),
		collections: z
			.record(z.string().max(63).regex(COLLECTION_SLUG_PATTERN), permissionNames)
			.optional(),
	})
	.meta({ id: "RoleUpdateBody" });

// ---------------------------------------------------------------------------
// Admin / Roles: Response schemas
// ---------------------------------------------------------------------------

export const roleSchema = z
	.object({
		id: z.string(),
		slug: z.string(),
		label: z.string(),
		description: z.string().nullable(),
		permissions: z.array(z.string()),
		collections: z.record(z.string(), z.array(z.string())),
		compatibilityLevel: z.number().int(),
		userCount: z.number().int(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.meta({ id: "Role" });

export const permissionCatalogEntrySchema = z
	.object({
		name: z.string(),
		minRole: z.number().int(),
		collectionScoped: z.boolean(),
		builtInAdminOnly: z.boolean(),
	})
	.meta({ id: "PermissionCatalogEntry" });

export const roleListResponseSchema = z
	.object({
		items: z.array(roleSchema),
		permissions: z.array(permissionCatalogEntrySchema),
	})
	.meta({ id: "RoleListResponse" });
