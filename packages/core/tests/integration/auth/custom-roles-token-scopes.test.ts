/**
 * Token scopes for a custom role come from its grants: a device-flow token
 * carries content:write when the role may create content somewhere, and the
 * MCP tool the role is allowed to use then runs.
 */

import { Role, scopesForActor, type User } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	handleDeviceAuthorize,
	handleDeviceCodeRequest,
	handleDeviceTokenExchange,
	handleTokenRefresh,
} from "../../../src/api/handlers/device-flow.js";
import { handleRoleCreate } from "../../../src/api/handlers/roles.js";
import type { Database } from "../../../src/database/types.js";
import {
	connectMcpHarness,
	extractText,
	isErrorResult,
	type McpHarness,
} from "../../utils/mcp-runtime.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../../utils/test-db.js";

let db: Kysely<Database>;
let pageEditor: User;

beforeEach(async () => {
	db = await setupTestDatabaseWithCollections();
	const adapter = createKyselyAdapter(db);
	const created = await handleRoleCreate(db, {
		slug: "page-editor",
		label: "Page editor",
		permissions: ["media:read", "media:upload"],
		collections: {
			page: ["content:read", "content:read_drafts", "content:create", "content:edit_any"],
		},
	});
	if (!created.success) throw new Error(created.error.message);
	const row = await adapter.createUser({
		email: "pages@test.com",
		role: created.data.item.compatibilityLevel,
		roleId: created.data.item.id,
	});
	pageEditor = (await adapter.getUserById(row.id))!;
	expect(pageEditor.role).toBe(Role.SUBSCRIBER);
});

afterEach(async () => {
	await teardownTestDatabase(db);
});

async function deviceFlow(requested: string): Promise<{ scope: string; refresh_token?: string }> {
	const code = await handleDeviceCodeRequest(
		db,
		{ scope: requested },
		"https://example.com/_emdash/device",
	);
	if (!code.success) throw new Error(code.error.message);
	const approved = await handleDeviceAuthorize(db, pageEditor.id, pageEditor, {
		user_code: code.data.user_code,
	});
	expect(approved.success, JSON.stringify(approved)).toBe(true);
	const token = await handleDeviceTokenExchange(db, {
		device_code: code.data.device_code,
		grant_type: "urn:ietf:params:oauth:grant-type:device_code",
	});
	if (!token.success) throw new Error(token.error.message);
	return token.data;
}

describe("device-flow scopes for a custom role", () => {
	let harness: McpHarness;

	afterEach(async () => {
		await harness?.cleanup();
	});

	it("derives the scopes from the grants, not from the stored level", async () => {
		const token = await deviceFlow("content:read content:write media:write schema:read admin");
		const scopes = token.scope.split(" ");
		expect(scopes.toSorted()).toEqual(
			scopesForActor(pageEditor)
				.filter((s) => scopes.includes(s))
				.toSorted(),
		);
		expect(scopes).toContain("content:write");
		expect(scopes).toContain("media:write");
		expect(scopes).not.toContain("schema:read");
		expect(scopes).not.toContain("admin");
	});

	it("keeps the grants' scopes on refresh", async () => {
		const token = await deviceFlow("content:read content:write");
		const refreshed = await handleTokenRefresh(db, {
			grant_type: "refresh_token",
			refresh_token: token.refresh_token!,
		});
		if (!refreshed.success) throw new Error(refreshed.error.message);
		expect(refreshed.data.scope.split(" ")).toContain("content:write");
	});

	it("lets the token use the write tool in the granted collection", async () => {
		const token = await deviceFlow("content:read content:write");
		harness = await connectMcpHarness({
			db,
			userId: pageEditor.id,
			userRole: pageEditor.role,
			customRole: pageEditor.customRole,
			tokenScopes: token.scope.split(" "),
			tokenId: "device-token",
		});
		const allowed = await harness.client.callTool({
			name: "content_create",
			arguments: { collection: "page", data: { title: "From MCP" } },
		});
		expect(isErrorResult(allowed), extractText(allowed)).toBe(false);
		const refused = await harness.client.callTool({
			name: "content_create",
			arguments: { collection: "post", data: { title: "Nope" } },
		});
		expect(isErrorResult(refused)).toBe(true);
		expect(extractText(refused)).toContain("INSUFFICIENT_PERMISSIONS");
	});
});
