import { hasPermission, Role, type Permission, type RoleLevel } from "@emdash-cms/auth";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../../src/database/types.js";
import { connectMcpHarness, type McpHarness } from "../../utils/mcp-runtime.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../../utils/test-db.js";

const ROLES: Array<{ name: string; level: RoleLevel }> = [
	{ name: "Subscriber", level: Role.SUBSCRIBER },
	{ name: "Contributor", level: Role.CONTRIBUTOR },
	{ name: "Author", level: Role.AUTHOR },
	{ name: "Editor", level: Role.EDITOR },
	{ name: "Admin", level: Role.ADMIN },
];

interface ToolCase {
	tool: string;
	/** The permission the matching REST route requires; a list means any of them. */
	permission: Permission | Permission[];
	/** Arguments that pass the tool's input schema. */
	args: Record<string, unknown>;
}

const entry = { collection: "post", id: "missing" };
const entryRev = { ...entry, _rev: "rev" };
const digest = `sha256:${"0".repeat(64)}`;

const TOOLS: ToolCase[] = [
	{
		tool: "content_create",
		permission: "content:create",
		args: { collection: "post", data: { title: "Hello" } },
	},
	{
		tool: "content_update",
		permission: ["content:edit_own", "content:edit_own_drafts"],
		args: { ...entryRev, data: { title: "Hello" } },
	},
	{ tool: "content_delete", permission: "content:delete_own", args: entry },
	{ tool: "content_restore", permission: "content:edit_own", args: entry },
	{ tool: "content_permanent_delete", permission: "content:delete_permanent", args: entry },
	{ tool: "content_publish", permission: "content:publish_own", args: entryRev },
	{ tool: "content_unpublish", permission: "content:publish_own", args: entryRev },
	{
		tool: "content_schedule",
		permission: "content:publish_own",
		args: { ...entryRev, scheduledAt: "2099-01-01T00:00:00Z" },
	},
	{ tool: "content_unschedule", permission: "content:publish_own", args: entry },
	{ tool: "content_discard_draft", permission: "content:edit_own", args: entryRev },
	{ tool: "content_duplicate", permission: "content:create", args: entry },
	{ tool: "revision_restore", permission: "content:edit_own", args: { revisionId: "missing" } },

	{
		tool: "byline_create",
		permission: "bylines:manage",
		args: { slug: "jane", displayName: "Jane" },
	},
	{ tool: "byline_update", permission: "bylines:manage", args: { id: "missing" } },
	{ tool: "byline_delete", permission: "bylines:manage", args: { id: "missing" } },

	{ tool: "schema_list_collections", permission: "schema:read", args: {} },
	{ tool: "schema_get_collection", permission: "schema:read", args: { slug: "post" } },
	{ tool: "schema_list_block_types", permission: "schema:read", args: {} },
	{ tool: "schema_get_block_type", permission: "schema:read", args: { slug: "missing" } },
	{
		tool: "schema_create_block_type",
		permission: "schema:manage",
		args: {
			slug: "quote",
			label: "Quote",
			fields: [{ slug: "text", label: "Text", type: "string" }],
		},
	},
	{
		tool: "schema_update_block_type",
		permission: "schema:manage",
		args: { slug: "missing", expectedFingerprint: "fingerprint" },
	},
	{
		tool: "schema_activate_block_type_version",
		permission: "schema:manage",
		args: { slug: "missing", version: 1, expectedFingerprint: "fingerprint" },
	},
	{
		tool: "schema_create_collection",
		permission: "schema:manage",
		args: { slug: "news", label: "News" },
	},
	{ tool: "schema_delete_collection", permission: "schema:manage", args: { slug: "missing" } },
	{ tool: "schema_update_collection", permission: "schema:manage", args: { slug: "missing" } },
	{
		tool: "schema_create_field",
		permission: "schema:manage",
		args: { collection: "missing", slug: "subtitle", label: "Subtitle", type: "string" },
	},
	{
		tool: "schema_delete_field",
		permission: "schema:manage",
		args: { collection: "missing", fieldSlug: "subtitle" },
	},
	{
		tool: "schema_update_field",
		permission: "schema:manage",
		args: { collection: "missing", fieldSlug: "subtitle" },
	},

	{ tool: "media_create", permission: "media:upload", args: { storageKey: "missing.png" } },
	{
		tool: "media_upload",
		permission: "media:upload",
		args: { filename: "pixel.png", base64: "AA==", contentType: "image/png" },
	},
	{ tool: "media_update", permission: "media:edit_own", args: { id: "missing" } },
	{ tool: "media_delete", permission: "media:delete_own", args: { id: "missing" } },
	{ tool: "media_usage_repair", permission: "schema:manage", args: { scope: "all" } },

	{
		tool: "taxonomy_create",
		permission: "taxonomies:manage",
		args: { name: "topic", label: "Topics" },
	},
	{ tool: "taxonomy_update", permission: "taxonomies:manage", args: { name: "missing" } },
	{ tool: "taxonomy_delete", permission: "taxonomies:manage", args: { name: "missing" } },
	{
		tool: "taxonomy_create_term",
		permission: "taxonomies:manage",
		args: { taxonomy: "missing", label: "News" },
	},
	{
		tool: "taxonomy_update_term",
		permission: "taxonomies:manage",
		args: { taxonomy: "missing", termSlug: "news" },
	},
	{
		tool: "taxonomy_delete_term",
		permission: "taxonomies:manage",
		args: { taxonomy: "missing", termSlug: "news" },
	},

	{ tool: "menu_create", permission: "menus:manage", args: { name: "footer", label: "Footer" } },
	{ tool: "menu_update", permission: "menus:manage", args: { name: "missing", label: "Footer" } },
	{ tool: "menu_delete", permission: "menus:manage", args: { name: "missing" } },
	{ tool: "menu_set_items", permission: "menus:manage", args: { name: "missing", items: [] } },

	{ tool: "settings_get", permission: "settings:read", args: {} },
	{ tool: "settings_update", permission: "settings:manage", args: {} },

	{
		tool: "site_transfer_capabilities",
		permission: ["transfer:export", "transfer:import"],
		args: {},
	},
	{ tool: "site_export_start", permission: "transfer:export", args: {} },
	{ tool: "site_export_status", permission: "transfer:export", args: { operationId: "missing" } },
	{ tool: "site_import_analyze", permission: "transfer:import", args: { operationId: "missing" } },
	{
		tool: "site_import_start",
		permission: "transfer:import",
		args: { operationId: "missing", packageDigest: digest, planDigest: digest },
	},
	{ tool: "site_import_status", permission: "transfer:import", args: { operationId: "missing" } },
	{ tool: "site_import_resume", permission: "transfer:import", args: { operationId: "missing" } },
	{ tool: "site_import_receipt", permission: "transfer:import", args: { operationId: "missing" } },
];

describe("MCP tools require the permission of their REST route", () => {
	let db: Kysely<Database>;
	const harnesses = new Map<string, McpHarness>();

	beforeAll(async () => {
		db = await setupTestDatabaseWithCollections();
		for (const role of ROLES) {
			harnesses.set(
				role.name,
				await connectMcpHarness({ db, userId: `user_${role.level}`, userRole: role.level }),
			);
		}
	});

	afterAll(async () => {
		for (const harness of harnesses.values()) await harness.cleanup();
		await teardownTestDatabase(db);
	});

	it.each(TOOLS)("$tool", async ({ tool, permission, args }) => {
		const required = [permission].flat();
		const refused: string[] = [];
		for (const role of ROLES) {
			const result = await harnesses
				.get(role.name)!
				.client.callTool({ name: tool, arguments: args });
			const code = (result as { _meta?: { code?: string } })._meta?.code;
			if (code === "INSUFFICIENT_PERMISSIONS") refused.push(role.name);
		}

		const lacking = ROLES.filter(
			(role) => !required.some((name) => hasPermission({ role: role.level }, name)),
		).map((role) => role.name);
		expect(refused).toEqual(lacking);
	});
});
