/**
 * Edges of collection scope: routes without a collection in the URL, reads
 * that cross collections, and the role management rules.
 */

import { Role, hasPermission, type User } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleDashboardStats } from "../../../src/api/handlers/dashboard.js";
import { handleRoleCreate } from "../../../src/api/handlers/roles.js";
import { DELETE as deletePolicyRejection } from "../../../src/astro/routes/api/admin/scheduled-policy-rejections/[collection]/[id].js";
import { PUT as putEntry } from "../../../src/astro/routes/api/content/[collection]/[id].js";
import { GET as getRevision } from "../../../src/astro/routes/api/revisions/[revisionId]/index.js";
import { POST as postBulkTag } from "../../../src/astro/routes/api/taxonomies/bulk-tag.js";
import type { EmDashHandlers } from "../../../src/astro/types.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import { OptionsRepository } from "../../../src/database/repositories/options.js";
import type { Database } from "../../../src/database/types.js";
import { scheduledPolicyRejectionKey } from "../../../src/plugins/content-policy.js";
import { validateSeed } from "../../../src/seed/validate.js";
import { createTestRuntime, handlersFromRuntime } from "../../utils/mcp-runtime.js";
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
let admin: User;
let pageEditor: User;
let pageEditorRoleId: string;

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
	pageEditorRoleId = created.data.item.id;
	admin = await adapter.createUser({ email: "admin@test.com", role: Role.ADMIN });
	const row = await adapter.createUser({
		email: "pages@test.com",
		role: created.data.item.compatibilityLevel,
		roleId: pageEditorRoleId,
	});
	pageEditor = (await adapter.getUserById(row.id))!;
});

afterEach(async () => {
	await teardownTestDatabase(db);
});

describe("routes without the collection in the URL", () => {
	it("answers a revision in a collection the role cannot read like a missing one", async () => {
		const postId = await createEntry("post", admin.id);
		await putEntry(
			ctx({
				user: admin,
				params: { collection: "post", id: postId },
				method: "PUT",
				body: { data: { title: "post v2" } },
			}),
		);
		const revision = await db
			.selectFrom("revisions")
			.select("id")
			.where("collection", "=", "post")
			.where("entry_id", "=", postId)
			.executeTakeFirstOrThrow();
		const existing = await getRevision(
			ctx({ user: pageEditor, params: { revisionId: revision.id } }),
		);
		const missing = await getRevision(
			ctx({ user: pageEditor, params: { revisionId: "01HZZZZZZZZZZZZZZZZZZZZZZZ" } }),
		);
		expect(existing.status).toBe(404);
		expect(missing.status).toBe(404);
	});

	it("lets a role dismiss a policy rejection in a collection where it may publish", async () => {
		expect(hasPermission(pageEditor, "content:publish_any", { collection: "page" })).toBe(true);
		const res = await deletePolicyRejection(
			ctx({
				user: pageEditor,
				params: { collection: "page", id: "entry-1" },
				method: "DELETE",
				url: "http://localhost/_emdash/api/admin/scheduled-policy-rejections/page/entry-1?rev=1",
			}),
		);
		// No rejection exists for that entry, so the dismissal does not apply;
		// the point is that the role is let through to it.
		expect(res.status).toBe(409);
		const other = await deletePolicyRejection(
			ctx({
				user: pageEditor,
				params: { collection: "post", id: "entry-1" },
				method: "DELETE",
				url: "http://localhost/_emdash/api/admin/scheduled-policy-rejections/post/entry-1?rev=1",
			}),
		);
		expect(other.status).toBe(403);
	});

	it("lets a role bulk-tag in the collection where it holds content:edit_any", async () => {
		expect(hasPermission(pageEditor, "content:edit_any", { collection: "page" })).toBe(true);
		const res = await postBulkTag(
			ctx({
				user: pageEditor,
				params: {},
				method: "POST",
				body: { termId: "t", apply: true, items: [{ collection: "page", id: "x" }] },
			}),
		);
		// The term does not exist; the role was let through to the handler.
		expect(res.status).toBe(404);
	});

	it("counts policy-rejected entries only in the collections the role may read", async () => {
		const options = new OptionsRepository(db);
		for (const [collection, id] of [
			["page", "p1"],
			["post", "x1"],
			["post", "x2"],
		] as const) {
			await options.set(scheduledPolicyRejectionKey(collection, id), {
				collection,
				id,
				pluginId: "policy-plugin",
				reason: "policy",
				rejectedAt: new Date().toISOString(),
			});
		}
		const scoped = await handleDashboardStats(db, {
			includeDrafts: true,
			readableCollections: ["page"],
		});
		const draftsInPageOnly = await handleDashboardStats(db, { includeDrafts: ["page"] });
		const everything = await handleDashboardStats(db, { includeDrafts: true });
		if (!scoped.success || !draftsInPageOnly.success || !everything.success) {
			throw new Error("dashboard failed");
		}
		expect(scoped.data.policyRejectedScheduled).toBe(1);
		expect(draftsInPageOnly.data.policyRejectedScheduled).toBe(1);
		expect(draftsInPageOnly.data.policyRejections.map((r) => r.collection)).toEqual(["page"]);
		expect(everything.data.policyRejectedScheduled).toBe(3);
	});
});

describe("role management edges", () => {
	it("refuses a built-in role's slug for a custom role", async () => {
		const result = await handleRoleCreate(db, { slug: "admin", label: "Admin", permissions: [] });
		expect(result.success).toBe(false);
		if (!result.success) expect(result.error.code).toBe("SLUG_CONFLICT");
	});

	it("rejects in seed validation what the apply step would reject", async () => {
		const role = { slug: "odd", label: "Odd", permissions: [123, "content:read"] };
		const validation = validateSeed({ version: "1", roles: [role] });
		expect(validation.errors.some((e) => e.startsWith("roles[0]"))).toBe(true);
		const applied = await handleRoleCreate(db, {
			...role,
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the seed loader passes the raw array through
			permissions: role.permissions as unknown as string[],
		});
		expect(applied.success).toBe(false);
		if (!applied.success) expect(applied.error.code).toBe("VALIDATION_ERROR");
	});
});
