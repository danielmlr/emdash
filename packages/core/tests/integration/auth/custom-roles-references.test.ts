/**
 * Reference fields that point into a collection the role cannot read: the
 * entry read resolves each target with the caller's rights there, and a
 * selection write is refused before any selected entry is looked up.
 */

import { Role, type User } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleRoleCreate } from "../../../src/api/handlers/roles.js";
import {
	GET as getEntry,
	PUT as putEntry,
} from "../../../src/astro/routes/api/content/[collection]/[id].js";
import type { EmDashHandlers } from "../../../src/astro/types.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import { RelationRepository } from "../../../src/database/repositories/relation.js";
import type { Database } from "../../../src/database/types.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import { createTestRuntime, handlersFromRuntime } from "../../utils/mcp-runtime.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../../utils/test-db.js";

let db: Kysely<Database>;
let handlers: EmDashHandlers;
let admin: User;
let pageEditor: User;

function ctx(opts: {
	user: User | undefined;
	params: Record<string, string>;
	method?: string;
	body?: unknown;
}): APIContext {
	const url = new URL("http://localhost/_emdash/api/test");
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

beforeEach(async () => {
	db = await setupTestDatabaseWithCollections();
	handlers = handlersFromRuntime(createTestRuntime(db));
	const adapter = createKyselyAdapter(db);

	// page.related -> post (one page links to many posts).
	await new RelationRepository(db).create({
		slug: "page_related",
		parentCollection: "page",
		childCollection: "post",
		parentLabel: "Page",
		childLabel: "Related post",
	});
	await new SchemaRegistry(db).createField("page", {
		slug: "related",
		label: "Related",
		type: "reference",
		validation: { relation: "page_related", relationSide: "parent", targetCollection: "post" },
	});

	const created = await handleRoleCreate(db, {
		slug: "page-editor",
		label: "Page editor",
		permissions: ["media:read"],
		collections: {
			page: ["content:read", "content:read_drafts", "content:create", "content:edit_any"],
		},
	});
	if (!created.success) throw new Error(created.error.message);
	admin = await adapter.createUser({ email: "admin@test.com", role: Role.ADMIN });
	const row = await adapter.createUser({
		email: "pages@test.com",
		role: created.data.item.compatibilityLevel,
		roleId: created.data.item.id,
	});
	pageEditor = (await adapter.getUserById(row.id))!;
});

afterEach(async () => {
	await teardownTestDatabase(db);
});

async function createEntry(collection: string, title: string, slug: string): Promise<string> {
	const item = await new ContentRepository(db).create({
		type: collection,
		data: { title },
		slug,
		status: "draft",
		authorId: admin.id,
	});
	return item.id;
}

describe("references into a collection the role cannot read", () => {
	it("does not hand the role titles of draft entries from that collection", async () => {
		const postId = await createEntry("post", "Secret launch", "secret-launch");
		const pageId = await createEntry("page", "About", "about");
		const linked = await putEntry(
			ctx({
				user: admin,
				params: { collection: "page", id: pageId },
				method: "PUT",
				body: { references: { related: [postId] } },
			}),
		);
		expect(linked.status).toBe(200);

		const read = await getEntry(
			ctx({ user: pageEditor, params: { collection: "page", id: pageId } }),
		);
		expect(read.status).toBe(200);
		const body = (await read.json()) as {
			data: {
				item: { references?: Record<string, { children?: Array<{ title: string; id: string }> }> };
			};
		};
		const children = body.data.item.references?.related?.children ?? [];
		expect(children).toEqual([]);

		// A built-in role reads the linked post as before.
		const adminRead = await getEntry(
			ctx({ user: admin, params: { collection: "page", id: pageId } }),
		);
		const adminBody = (await adminRead.json()) as {
			data: { item: { references?: Record<string, { children?: Array<{ title: string }> }> } };
		};
		expect(adminBody.data.item.references?.related?.children?.map((c) => c.title)).toEqual([
			"Secret launch",
		]);
	});

	it("resolves a readable target with the caller's draft right there, not the anchor's", async () => {
		const adapter = createKyselyAdapter(db);
		const created = await handleRoleCreate(db, {
			slug: "page-editor-post-reader",
			label: "Page editor, post reader",
			collections: {
				page: ["content:read", "content:read_drafts", "content:edit_any"],
				post: ["content:read"],
			},
		});
		if (!created.success) throw new Error(created.error.message);
		const row = await adapter.createUser({
			email: "mixed@test.com",
			role: created.data.item.compatibilityLevel,
			roleId: created.data.item.id,
		});
		const mixed = (await adapter.getUserById(row.id))!;

		const draftPost = await createEntry("post", "Secret launch", "secret-launch");
		const livePost = await new ContentRepository(db).create({
			type: "post",
			data: { title: "Public launch" },
			slug: "public-launch",
			status: "published",
			authorId: admin.id,
		});
		const pageId = await createEntry("page", "About", "about");
		await putEntry(
			ctx({
				user: admin,
				params: { collection: "page", id: pageId },
				method: "PUT",
				body: { references: { related: [draftPost, livePost.id] } },
			}),
		);

		const read = await getEntry(ctx({ user: mixed, params: { collection: "page", id: pageId } }));
		const body = (await read.json()) as {
			data: { item: { references?: Record<string, { children?: Array<{ title: string }> }> } };
		};
		expect(body.data.item.references?.related?.children?.map((c) => c.title)).toEqual([
			"Public launch",
		]);
	});

	it("does not let the role resolve, probe or link entries of that collection by slug", async () => {
		await createEntry("post", "Secret launch", "secret-launch");
		const pageId = await createEntry("page", "About", "about");

		const missing = await putEntry(
			ctx({
				user: pageEditor,
				params: { collection: "page", id: pageId },
				method: "PUT",
				body: { references: { related: ["no-such-post"] } },
			}),
		);
		const existing = await putEntry(
			ctx({
				user: pageEditor,
				params: { collection: "page", id: pageId },
				method: "PUT",
				body: { references: { related: ["secret-launch"] } },
			}),
		);
		expect(missing.status).toBe(403);
		expect(existing.status).toBe(403);
		const links = await db.selectFrom("_emdash_content_references").selectAll().execute();
		expect(links).toEqual([]);
	});
});
