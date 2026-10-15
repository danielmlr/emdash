/**
 * Custom roles against a real database: role storage, the user lookup that
 * carries the role, collection scope on REST routes and MCP tools, and the
 * compatibility level kept in `users.role`.
 */

import { Role, type User } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { APIContext } from "astro";
import { sql, type Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleDashboardStats } from "../../../src/api/handlers/dashboard.js";
import {
	handleRoleCreate,
	handleRoleDelete,
	handleRoleUpdate,
} from "../../../src/api/handlers/roles.js";
import { GET as getMe } from "../../../src/astro/routes/api/auth/me.js";
import {
	GET as getEntry,
	PUT as putEntry,
} from "../../../src/astro/routes/api/content/[collection]/[id].js";
import { POST as postPublish } from "../../../src/astro/routes/api/content/[collection]/[id]/publish.js";
import {
	GET as getList,
	POST as postCreate,
} from "../../../src/astro/routes/api/content/[collection]/index.js";
import { GET as getRevision } from "../../../src/astro/routes/api/revisions/[revisionId]/index.js";
import type { EmDashHandlers } from "../../../src/astro/types.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import type { Database } from "../../../src/database/types.js";
import {
	connectMcpHarness,
	createTestRuntime,
	currentRev,
	extractText,
	handlersFromRuntime,
	isErrorResult,
	type McpHarness,
} from "../../utils/mcp-runtime.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../../utils/test-db.js";

const PAGE_EDITOR_GRANTS = {
	permissions: ["media:read", "media:upload", "taxonomies:read"],
	collections: {
		page: [
			"content:read",
			"content:read_drafts",
			"content:create",
			"content:edit_any",
			"content:delete_any",
			"content:publish_any",
		],
	},
};

let db: Kysely<Database>;
let handlers: EmDashHandlers;
let pageEditor: User;
let admin: User;
let roleId: string;

function ctx(opts: {
	user: User | undefined;
	params: Record<string, string>;
	method?: string;
	body?: unknown;
	url?: string;
}): APIContext {
	const url = new URL(opts.url ?? "http://localhost/_emdash/api/test");
	const request = new Request(url, {
		method: opts.method ?? "GET",
		headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
	});
	return {
		params: opts.params,
		url,
		request,
		locals: { user: opts.user, emdash: handlers },
		cache: { enabled: false, invalidate: vi.fn() },
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal APIContext for route handlers
	} as unknown as APIContext;
}

async function createEntry(collection: string, authorId: string): Promise<string> {
	const item = await new ContentRepository(db).create({
		type: collection,
		data: { title: `${collection} entry` },
		slug: `${collection}-${Math.random().toString(36).slice(2, 8)}`,
		status: "draft",
		authorId,
	});
	return item.id;
}

beforeEach(async () => {
	db = await setupTestDatabaseWithCollections();
	handlers = handlersFromRuntime(createTestRuntime(db));
	const adapter = createKyselyAdapter(db);

	const created = await handleRoleCreate(db, {
		slug: "page-editor",
		label: "Page editor",
		...PAGE_EDITOR_GRANTS,
	});
	if (!created.success) throw new Error(created.error.message);
	roleId = created.data.item.id;

	admin = await adapter.createUser({ email: "admin@test.com", role: Role.ADMIN });
	const editorRow = await adapter.createUser({
		email: "pages@test.com",
		role: created.data.item.compatibilityLevel,
		roleId,
	});
	const loaded = await adapter.getUserById(editorRow.id);
	if (!loaded) throw new Error("user not found");
	pageEditor = loaded;
});

afterEach(async () => {
	await teardownTestDatabase(db);
});

describe("loading a user with a custom role", () => {
	it("attaches the role's grants and stores the Subscriber floor as the level", () => {
		expect(pageEditor.customRole?.slug).toBe("page-editor");
		expect(pageEditor.customRole?.grants.collections.page).toContain("content:edit_own");
		expect(pageEditor.role).toBe(Role.SUBSCRIBER);
	});

	it("gives a user whose role row is gone no permissions at all", async () => {
		// The foreign key keeps this from happening; switch it off to reach the
		// fallback that runs when the database does not enforce it.
		await sql`PRAGMA foreign_keys = OFF`.execute(db);
		await db
			.updateTable("users")
			.set({ role_id: "missing-role" })
			.where("id", "=", pageEditor.id)
			.execute();
		await sql`PRAGMA foreign_keys = ON`.execute(db);
		const orphan = await createKyselyAdapter(db).getUserById(pageEditor.id);
		expect(orphan?.customRole?.grants).toEqual({ permissions: [], collections: {} });
		const res = await getList(ctx({ user: orphan ?? undefined, params: { collection: "page" } }));
		expect(res.status).toBe(403);
	});

	it("reports effective permissions from /auth/me", async () => {
		const res = await getMe(ctx({ user: pageEditor, params: {} }));
		const body = (await res.json()) as {
			data: { permissions: string[]; collections: Record<string, string[]>; customRole: unknown };
		};
		expect(body.data.customRole).toMatchObject({ slug: "page-editor", label: "Page editor" });
		expect(body.data.permissions).toEqual(["media:read", "media:upload", "taxonomies:read"]);
		expect(Object.keys(body.data.collections)).toEqual(["page"]);
	});
});

describe("collection scope on REST routes", () => {
	it("lists and creates in the granted collection only", async () => {
		expect((await getList(ctx({ user: pageEditor, params: { collection: "page" } }))).status).toBe(
			200,
		);
		expect((await getList(ctx({ user: pageEditor, params: { collection: "post" } }))).status).toBe(
			403,
		);

		const created = await postCreate(
			ctx({
				user: pageEditor,
				params: { collection: "page" },
				method: "POST",
				body: { data: { title: "About" } },
			}),
		);
		expect(created.status).toBe(201);
		const refused = await postCreate(
			ctx({
				user: pageEditor,
				params: { collection: "post" },
				method: "POST",
				body: { data: { title: "Hello" } },
			}),
		);
		expect(refused.status).toBe(403);
	});

	it("edits and publishes anyone's entry in the granted collection", async () => {
		const pageId = await createEntry("page", admin.id);
		const edited = await putEntry(
			ctx({
				user: pageEditor,
				params: { collection: "page", id: pageId },
				method: "PUT",
				body: { data: { title: "Edited" } },
			}),
		);
		expect(edited.status).toBe(200);
		const published = await postPublish(
			ctx({ user: pageEditor, params: { collection: "page", id: pageId }, method: "POST" }),
		);
		expect(published.status).toBe(200);
	});

	it("answers 403, not 404, in a collection it cannot reach, whether or not the entry exists", async () => {
		const postId = await createEntry("post", admin.id);
		for (const id of [postId, "does-not-exist"]) {
			const read = await getEntry(ctx({ user: pageEditor, params: { collection: "post", id } }));
			expect(read.status).toBe(403);
			const edit = await putEntry(
				ctx({
					user: pageEditor,
					params: { collection: "post", id },
					method: "PUT",
					body: { data: { title: "Nope" } },
				}),
			);
			expect(edit.status).toBe(403);
		}
	});

	it("checks a revision against the collection it belongs to", async () => {
		const pageId = await createEntry("page", admin.id);
		const postId = await createEntry("post", admin.id);
		for (const [collection, id] of [
			["page", pageId],
			["post", postId],
		] as const) {
			await putEntry(
				ctx({
					user: admin,
					params: { collection, id },
					method: "PUT",
					body: { data: { title: `${collection} v2` } },
				}),
			);
		}
		const revisionOf = async (collection: string, entryId: string) => {
			const row = await db
				.selectFrom("revisions")
				.select("id")
				.where("collection", "=", collection)
				.where("entry_id", "=", entryId)
				.executeTakeFirstOrThrow();
			return row.id;
		};
		const pageRevision = await getRevision(
			ctx({ user: pageEditor, params: { revisionId: await revisionOf("page", pageId) } }),
		);
		expect(pageRevision.status).toBe(200);
		const postRevision = await getRevision(
			ctx({ user: pageEditor, params: { revisionId: await revisionOf("post", postId) } }),
		);
		expect(postRevision.status).toBe(404);
	});

	it("leaves built-in roles unaffected", async () => {
		const postId = await createEntry("post", admin.id);
		const res = await getEntry(ctx({ user: admin, params: { collection: "post", id: postId } }));
		expect(res.status).toBe(200);
	});
});

describe("collection scope on MCP tools", () => {
	let harness: McpHarness;

	afterEach(async () => {
		await harness?.cleanup();
	});

	it("refuses tools on other collections and allows them on the granted one", async () => {
		const postId = await createEntry("post", admin.id);
		const pageId = await createEntry("page", admin.id);
		const adminHarness = await connectMcpHarness({ db, userId: admin.id, userRole: Role.ADMIN });
		const postRev = await currentRev(adminHarness.client, "post", postId);
		const pageRev = await currentRev(adminHarness.client, "page", pageId);
		await adminHarness.cleanup();

		harness = await connectMcpHarness({
			db,
			userId: pageEditor.id,
			userRole: pageEditor.role,
			customRole: pageEditor.customRole,
		});

		const refused = await harness.client.callTool({
			name: "content_update",
			arguments: { collection: "post", id: postId, data: { title: "Nope" }, _rev: postRev },
		});
		expect(isErrorResult(refused)).toBe(true);
		expect(extractText(refused)).toContain("INSUFFICIENT_PERMISSIONS");

		const listed = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post" },
		});
		expect(extractText(listed)).toContain("INSUFFICIENT_PERMISSIONS");

		const allowed = await harness.client.callTool({
			name: "content_update",
			arguments: { collection: "page", id: pageId, data: { title: "Yes" }, _rev: pageRev },
		});
		expect(isErrorResult(allowed), extractText(allowed)).toBe(false);
	});
});

describe("a draft-only role scoped to one collection", () => {
	let drafter: User;
	let harness: McpHarness | undefined;

	beforeEach(async () => {
		const created = await handleRoleCreate(db, {
			slug: "page-drafter",
			label: "Page drafter",
			collections: {
				page: ["content:read", "content:read_drafts", "content:create", "content:edit_own_drafts"],
			},
		});
		if (!created.success) throw new Error(created.error.message);
		const adapter = createKyselyAdapter(db);
		const row = await adapter.createUser({
			email: "drafter@test.com",
			role: created.data.item.compatibilityLevel,
			roleId: created.data.item.id,
		});
		const loaded = await adapter.getUserById(row.id);
		if (!loaded) throw new Error("user not found");
		drafter = loaded;
	});

	afterEach(async () => {
		await harness?.cleanup();
		harness = undefined;
	});

	async function ownEntries() {
		const ownDraft = await createEntry("page", drafter.id);
		const ownPublished = await createEntry("page", drafter.id);
		await db
			.updateTable("ec_page" as never)
			.set({ status: "published" } as never)
			.where("id" as never, "=", ownPublished as never)
			.execute();
		const ownPostDraft = await createEntry("post", drafter.id);
		return [
			["page", ownDraft, true],
			["page", ownPublished, false],
			["post", ownPostDraft, false],
		] as const;
	}

	it("saves its own drafts in that collection only, through REST", async () => {
		for (const [collection, id, allowed] of await ownEntries()) {
			const res = await putEntry(
				ctx({
					user: drafter,
					params: { collection, id },
					method: "PUT",
					body: { data: { title: "Edited" } },
				}),
			);
			expect(res.status, `${collection} ${allowed ? "draft" : "refused"}`).toBe(
				allowed ? 200 : 403,
			);
		}
	});

	it("saves its own drafts in that collection only, through MCP", async () => {
		const entries = await ownEntries();
		const adminHarness = await connectMcpHarness({ db, userId: admin.id, userRole: Role.ADMIN });
		const revs = await Promise.all(
			entries.map(([collection, id]) => currentRev(adminHarness.client, collection, id)),
		);
		await adminHarness.cleanup();

		harness = await connectMcpHarness({
			db,
			userId: drafter.id,
			userRole: drafter.role,
			customRole: drafter.customRole,
		});
		for (const [index, [collection, id, allowed]] of entries.entries()) {
			const result = await harness.client.callTool({
				name: "content_update",
				arguments: { collection, id, data: { title: "Edited" }, _rev: revs[index] },
			});
			expect(isErrorResult(result), extractText(result)).toBe(!allowed);
		}
	});
});

describe("role management", () => {
	it("rejects permissions that only the built-in Admin may hold", async () => {
		const result = await handleRoleCreate(db, {
			slug: "user-admin",
			label: "User admin",
			permissions: ["users:manage"],
		});
		expect(result.success).toBe(false);
		if (!result.success) expect(result.error.code).toBe("VALIDATION_ERROR");
	});

	it("rewrites the stored level of every user when the role changes", async () => {
		const editorPermissions = [
			...PAGE_EDITOR_GRANTS.permissions,
			"content:read",
			"content:read_drafts",
			"content:create",
			"content:edit_own",
			"content:delete_own",
			"content:publish_own",
			"media:edit_own",
			"media:delete_own",
			"comments:read",
			"menus:read",
			"bylines:read",
			"widgets:read",
			"sections:read",
			"search:read",
			"auth:manage_own_credentials",
		];
		const updated = await handleRoleUpdate(db, roleId, { permissions: editorPermissions });
		expect(updated.success).toBe(true);
		if (updated.success) expect(updated.data.item.compatibilityLevel).toBe(Role.AUTHOR);
		const row = await db
			.selectFrom("users")
			.select("role")
			.where("id", "=", pageEditor.id)
			.executeTakeFirstOrThrow();
		expect(row.role).toBe(Role.AUTHOR);
	});

	it("refuses to delete a role that is assigned", async () => {
		const result = await handleRoleDelete(db, roleId);
		expect(result.success).toBe(false);
		if (!result.success) expect(result.error.code).toBe("ROLE_IN_USE");
	});
});

describe("cross-collection reads", () => {
	it("limits dashboard stats to readable collections", async () => {
		await createEntry("post", admin.id);
		await createEntry("page", admin.id);
		const result = await handleDashboardStats(db, {
			includeDrafts: true,
			readableCollections: ["page"],
		});
		if (!result.success) throw new Error(result.error.message);
		expect(result.data.collections.map((c) => c.slug)).toEqual(["page"]);
		expect(result.data.recentItems.every((item) => item.collection === "page")).toBe(true);
	});
});
