/**
 * The snapshot route hands out drafts and revisions only with
 * content:read_drafts; a role with content:read and schema:read alone gets
 * published rows.
 */

import { Role, type User } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleRoleCreate } from "../../../src/api/handlers/roles.js";
import { PUT as putEntry } from "../../../src/astro/routes/api/content/[collection]/[id].js";
import { GET as getSnapshot } from "../../../src/astro/routes/api/snapshot.js";
import type { EmDashHandlers } from "../../../src/astro/types.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import type { Database } from "../../../src/database/types.js";
import { createTestRuntime, handlersFromRuntime } from "../../utils/mcp-runtime.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../../utils/test-db.js";

let db: Kysely<Database>;
let handlers: EmDashHandlers;
let admin: User;
let reader: User;

async function snapshotAs(user: User): Promise<Record<string, Record<string, unknown>[]>> {
	const url = new URL("http://localhost/_emdash/api/snapshot?drafts=true");
	const response = await getSnapshot({
		request: new Request(url),
		url,
		locals: { user, emdash: { db, config: {}, handlers } },
		session: undefined,
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal APIContext
	} as unknown as APIContext);
	expect(response.status).toBe(200);
	const body = (await response.json()) as {
		data: { tables: Record<string, Record<string, unknown>[]> };
	};
	return body.data.tables;
}

beforeEach(async () => {
	db = await setupTestDatabaseWithCollections();
	handlers = handlersFromRuntime(createTestRuntime(db));
	const adapter = createKyselyAdapter(db);
	admin = await adapter.createUser({ email: "admin@test.com", role: Role.ADMIN });
	const created = await handleRoleCreate(db, {
		slug: "schema-reader",
		label: "Schema reader",
		permissions: ["content:read", "schema:read"],
	});
	if (!created.success) throw new Error(created.error.message);
	const row = await adapter.createUser({
		email: "reader@test.com",
		role: created.data.item.compatibilityLevel,
		roleId: created.data.item.id,
	});
	reader = (await adapter.getUserById(row.id))!;

	const repo = new ContentRepository(db);
	await repo.create({
		type: "post",
		data: { title: "Public" },
		slug: "public",
		status: "published",
		authorId: admin.id,
	});
	const draft = await repo.create({
		type: "post",
		data: { title: "Secret" },
		slug: "secret",
		status: "draft",
		authorId: admin.id,
	});
	const url = new URL("http://localhost/_emdash/api/test");
	await putEntry({
		params: { collection: "post", id: draft.id },
		url,
		request: new Request(url, {
			method: "PUT",
			headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
			body: JSON.stringify({ data: { title: "Secret v2" } }),
		}),
		locals: { user: admin, emdash: handlers },
		cache: { enabled: false, invalidate: vi.fn() },
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal APIContext
	} as unknown as APIContext);
});

afterEach(async () => {
	await teardownTestDatabase(db);
});

describe("snapshot drafts for a role without content:read_drafts", () => {
	it("returns published rows only and no revisions", async () => {
		const tables = await snapshotAs(reader);
		expect(tables.ec_post?.map((row) => row.slug)).toEqual(["public"]);
		expect(tables.revisions ?? []).toEqual([]);
	});

	it("still returns drafts and revisions to a role that holds the permission", async () => {
		const tables = await snapshotAs(admin);
		expect(tables.ec_post?.map((row) => row.slug).toSorted()).toEqual(["public", "secret"]);
		expect((tables.revisions ?? []).length).toBeGreaterThan(0);
	});
});
