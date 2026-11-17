import { Role, type RoleLevel } from "@emdash-cms/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PUT as updateContent } from "../../../src/astro/routes/api/content/[collection]/[id].js";
import { POST as discardDraft } from "../../../src/astro/routes/api/content/[collection]/[id]/discard-draft.js";
import { POST as duplicateContent } from "../../../src/astro/routes/api/content/[collection]/[id]/duplicate.js";
import { POST as acquireLock } from "../../../src/astro/routes/api/content/[collection]/[id]/lock.js";
import { POST as restoreContent } from "../../../src/astro/routes/api/content/[collection]/[id]/restore.js";
import { POST as setTerms } from "../../../src/astro/routes/api/content/[collection]/[id]/terms/[taxonomy].js";
import { POST as createContent } from "../../../src/astro/routes/api/content/[collection]/index.js";
import type { EmDashHandlers } from "../../../src/astro/types.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import type { EmDashRuntime } from "../../../src/emdash-runtime.js";
import { setI18nConfig } from "../../../src/i18n/config.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import {
	connectMcpHarness,
	createTestRuntime,
	currentRev,
	extractText,
	handlersFromRuntime,
	type McpHarness,
} from "../../utils/mcp-runtime.js";
import {
	describeEachDialect,
	setupForDialectWithCollections,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

const CONTRIBUTOR_ID = "user_contributor";
const OTHER_ID = "user_other";
const contributor = { id: CONTRIBUTOR_ID, role: Role.CONTRIBUTOR as RoleLevel };

type Status = "draft" | "published" | "scheduled";

describeEachDialect("Contributor editing their own drafts", (dialect) => {
	let ctx: DialectTestContext;
	let runtime: EmDashRuntime;
	let handlers: EmDashHandlers;
	let harness: McpHarness | undefined;

	beforeEach(async () => {
		ctx = await setupForDialectWithCollections(dialect);
		await ctx.db
			.insertInto("users")
			.values([
				{
					id: CONTRIBUTOR_ID,
					email: "contributor@example.com",
					name: "Contributor",
					role: Role.CONTRIBUTOR,
					email_verified: 1,
				},
				{
					id: OTHER_ID,
					email: "other@example.com",
					name: "Other",
					role: Role.CONTRIBUTOR,
					email_verified: 1,
				},
			])
			.execute();
		// Without revisions, a save writes the entry's columns directly, so a save
		// to a published entry changes live content.
		const registry = new SchemaRegistry(ctx.db);
		await registry.createCollection({ slug: "note", label: "Notes", supports: [] });
		await registry.createField("note", { slug: "title", label: "Title", type: "string" });
		runtime = createTestRuntime(ctx.db);
		handlers = handlersFromRuntime(runtime);
	});

	afterEach(async () => {
		await harness?.cleanup();
		harness = undefined;
		await teardownForDialect(ctx);
	});

	async function seed(
		status: Status,
		{ authorId = CONTRIBUTOR_ID, collection = "post" } = {},
	): Promise<string> {
		const item = await new ContentRepository(ctx.db).create({
			type: collection,
			data: { title: "Original" },
			slug: `entry-${Math.random().toString(36).slice(2, 8)}`,
			status,
			authorId,
			...(status === "scheduled" ? { scheduledAt: "2099-01-01T00:00:00.000Z" } : {}),
		});
		return item.id;
	}

	/** The title an editor sees, including any unpublished draft revision. */
	async function title(id: string, collection = "post"): Promise<unknown> {
		const result = await runtime.handleContentGet(collection, id);
		if (!result.success) throw new Error(result.error.message);
		return result.data.item.data.title;
	}

	/** The title visitors see. */
	async function liveTitle(id: string, collection: string): Promise<unknown> {
		const item = await new ContentRepository(ctx.db).findById(collection, id);
		return item?.data.title;
	}

	function put(
		id: string,
		{
			collection = "post",
			emdash = handlers,
		}: { collection?: string; emdash?: EmDashHandlers } = {},
	): Promise<Response> {
		return updateContent({
			params: { collection, id },
			request: new Request(`http://localhost/_emdash/api/content/${collection}/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ data: { title: "Edited" } }),
			}),
			locals: { emdash, user: contributor },
			cache: { enabled: false, invalidate: vi.fn() },
		} as unknown as Parameters<typeof updateContent>[0]);
	}

	describe("PUT /content/:collection/:id", () => {
		it("saves the Contributor's own draft", async () => {
			const id = await seed("draft");

			const response = await put(id);

			expect(response.status, await response.clone().text()).toBe(200);
			expect(await title(id)).toBe("Edited");
		});

		it.each(["published", "scheduled"] as const)(
			"refuses the Contributor's own %s entry",
			async (status) => {
				const id = await seed(status);

				const response = await put(id);

				expect(response.status).toBe(403);
				expect(await title(id)).toBe("Original");
			},
		);

		it("refuses another user's draft", async () => {
			const id = await seed("draft", { authorId: OTHER_ID });

			const response = await put(id);

			expect(response.status).toBe(403);
			expect(await title(id)).toBe("Original");
		});

		it("refuses the save when the entry is published after the permission check", async () => {
			const id = await seed("draft", { collection: "note" });
			const publishAfterCheck: EmDashHandlers = {
				...handlers,
				handleContentGet: async (...args) => {
					const result = await handlers.handleContentGet(...args);
					const published = await runtime.handleContentPublish("note", id, {});
					if (!published.success) throw new Error(published.error.message);
					return result;
				},
			};

			const response = await put(id, { collection: "note", emdash: publishAfterCheck });

			expect(response.status).toBe(409);
			expect(await liveTitle(id, "note")).toBe("Original");
		});
	});

	describe("entry lock and terms routes", () => {
		function routeContext(id: string, path: string, body: unknown) {
			const url = `http://localhost/_emdash/api/content/post/${id}/${path}`;
			return {
				params: { collection: "post", id, taxonomy: "category" },
				request: new Request(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				}),
				url: new URL(url),
				locals: { emdash: handlers, user: contributor },
				cache: { enabled: false, invalidate: vi.fn() },
			};
		}

		it("lets the Contributor lock their own draft but not their published entry", async () => {
			const draftId = await seed("draft");
			const publishedId = await seed("published");

			const draft = await acquireLock(
				routeContext(draftId, "lock", {}) as unknown as Parameters<typeof acquireLock>[0],
			);
			const published = await acquireLock(
				routeContext(publishedId, "lock", {}) as unknown as Parameters<typeof acquireLock>[0],
			);

			expect(draft.status, await draft.clone().text()).toBe(200);
			expect(published.status).toBe(403);
		});

		it("lets the Contributor set terms on their own draft but not their published entry", async () => {
			const draftId = await seed("draft");
			const publishedId = await seed("published");

			const draft = await setTerms(
				routeContext(draftId, "terms/category", { termIds: [] }) as unknown as Parameters<
					typeof setTerms
				>[0],
			);
			const published = await setTerms(
				routeContext(publishedId, "terms/category", { termIds: [] }) as unknown as Parameters<
					typeof setTerms
				>[0],
			);

			expect(draft.status, await draft.clone().text()).toBe(200);
			expect(published.status).toBe(403);
		});
	});

	describe("MCP content_update", () => {
		async function mcpUpdate(id: string) {
			harness = await connectMcpHarness({
				db: ctx.db,
				userId: CONTRIBUTOR_ID,
				userRole: Role.CONTRIBUTOR,
			});
			return harness.client.callTool({
				name: "content_update",
				arguments: {
					collection: "post",
					id,
					data: { title: "Edited" },
					_rev: await currentRev(harness.client, "post", id),
				},
			});
		}

		it("saves the Contributor's own draft", async () => {
			const id = await seed("draft");

			const result = await mcpUpdate(id);

			expect(result.isError, extractText(result)).toBeFalsy();
			expect(await title(id)).toBe("Edited");
		});

		it("refuses the Contributor's own published entry", async () => {
			const id = await seed("published");

			const result = await mcpUpdate(id);

			expect(result.isError).toBe(true);
			expect(await title(id)).toBe("Original");
		});
	});

	describe("discard, restore, duplicate and translate", () => {
		type Surface = "REST" | "MCP";
		type Route = (context: never) => Response | Promise<Response>;

		interface Operation {
			name: string;
			/** Puts a seeded entry into the state the operation acts on. */
			prepare?: (id: string) => Promise<void>;
			/** What the operation changes, read before and after it. */
			effect: (id: string) => Promise<unknown>;
			/** A change another user makes between the permission check and the write. */
			change: (id: string) => Promise<void>;
			route: Route;
			path: (id: string) => string;
			body?: (id: string) => unknown;
			tool: string;
			toolArgs: (id: string) => Promise<Record<string, unknown>>;
		}

		const repo = () => new ContentRepository(ctx.db);
		const entryCount = async () => (await repo().findMany("post", { limit: 100 })).items.length;

		async function publish(id: string): Promise<void> {
			const published = await runtime.handleContentPublish("post", id, {});
			if (!published.success) throw new Error(published.error.message);
		}

		const OPERATIONS: Operation[] = [
			{
				name: "discard the draft of",
				prepare: async (id) => {
					const saved = await runtime.handleContentUpdate("post", id, {
						data: { title: "Edited" },
					});
					if (!saved.success) throw new Error(saved.error.message);
				},
				effect: (id) => title(id),
				change: publish,
				route: discardDraft as Route,
				path: (id) => `${id}/discard-draft`,
				body: () => ({}),
				tool: "content_discard_draft",
				toolArgs: async (id) => {
					const entry = await runtime.handleContentGet("post", id);
					if (!entry.success) throw new Error(entry.error.message);
					return { id, _rev: entry.data._rev };
				},
			},
			{
				name: "restore",
				prepare: async (id) => {
					await repo().delete("post", id);
				},
				effect: async (id) => (await repo().findById("post", id)) !== null,
				change: async (id) => {
					await runtime.handleContentRestore("post", id);
					await publish(id);
					await repo().delete("post", id);
				},
				route: restoreContent as Route,
				path: (id) => `${id}/restore`,
				tool: "content_restore",
				toolArgs: async (id) => ({ id }),
			},
			{
				name: "duplicate",
				effect: entryCount,
				change: publish,
				route: duplicateContent as Route,
				path: (id) => `${id}/duplicate`,
				tool: "content_duplicate",
				toolArgs: async (id) => ({ id }),
			},
			{
				name: "translate",
				effect: entryCount,
				change: publish,
				route: createContent as Route,
				path: () => "",
				body: (id) => ({ data: { title: "Traduction" }, locale: "fr", translationOf: id }),
				tool: "content_create",
				toolArgs: async (id) => ({
					data: { title: "Traduction" },
					locale: "fr",
					translationOf: id,
				}),
			},
		];

		beforeEach(() => {
			setI18nConfig({ defaultLocale: "en", locales: ["en", "fr"] });
		});

		afterEach(() => {
			setI18nConfig(null);
		});

		/** Runs `afterRead` once, right after the entry is read for the permission check. */
		function changeAfterCheck(emdash: EmDashHandlers, afterRead: () => Promise<void>) {
			let pending = true;
			const once = async <T>(result: T): Promise<T> => {
				if (pending) {
					pending = false;
					await afterRead();
				}
				return result;
			};
			const { handleContentGet, handleContentGetIncludingTrashed } = emdash;
			emdash.handleContentGet = async (...args) => once(await handleContentGet(...args));
			emdash.handleContentGetIncludingTrashed = async (...args) =>
				once(await handleContentGetIncludingTrashed(...args));
		}

		async function run(
			surface: Surface,
			operation: Operation,
			id: string,
			options: { user?: typeof contributor; afterCheck?: () => Promise<void> } = {},
		): Promise<string> {
			const user = options.user ?? contributor;
			if (surface === "MCP") {
				harness = await connectMcpHarness({ db: ctx.db, userId: user.id, userRole: user.role });
				const args = { collection: "post", ...(await operation.toolArgs(id)) };
				if (options.afterCheck) changeAfterCheck(harness.handlers, options.afterCheck);
				const result = await harness.client.callTool({ name: operation.tool, arguments: args });
				if (!result.isError) return "done";
				const code = (result as { _meta?: { code?: string } })._meta?.code;
				if (code === "INSUFFICIENT_PERMISSIONS") return "refused";
				return code === "CONFLICT" ? "conflict" : extractText(result);
			}

			const emdash = { ...handlers };
			if (options.afterCheck) changeAfterCheck(emdash, options.afterCheck);
			const url = `http://localhost/_emdash/api/content/post/${operation.path(id)}`;
			const body = operation.body?.(id);
			const response = await operation.route({
				params: { collection: "post", id },
				request: new Request(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					...(body ? { body: JSON.stringify(body) } : {}),
				}),
				url: new URL(url),
				locals: { emdash, user },
				cache: { enabled: false, invalidate: vi.fn() },
			} as never);
			if (response.ok) return "done";
			if (response.status === 403) return "refused";
			return response.status === 409 ? "conflict" : await response.text();
		}

		async function seedFor(
			operation: Operation,
			status: Status,
			authorId = CONTRIBUTOR_ID,
		): Promise<string> {
			const id = await seed(status, { authorId });
			await operation.prepare?.(id);
			return id;
		}

		describe.each(["REST", "MCP"] as const)("%s", (surface) => {
			it.each(OPERATIONS)("lets the Contributor $name their own draft", async (operation) => {
				const id = await seedFor(operation, "draft");
				const before = await operation.effect(id);

				expect(await run(surface, operation, id)).toBe("done");
				expect(await operation.effect(id)).not.toEqual(before);
			});

			it.each(OPERATIONS)("refuses to $name their own published entry", async (operation) => {
				const id = await seedFor(operation, "published");
				const before = await operation.effect(id);

				expect(await run(surface, operation, id)).toBe("refused");
				expect(await operation.effect(id)).toEqual(before);
			});

			it.each(OPERATIONS)("refuses to $name another user's draft", async (operation) => {
				const id = await seedFor(operation, "draft", OTHER_ID);
				const before = await operation.effect(id);

				expect(await run(surface, operation, id)).toBe("refused");
				expect(await operation.effect(id)).toEqual(before);
			});

			it.each(OPERATIONS)(
				"fails to $name their own draft when it is published after the permission check",
				async (operation) => {
					const id = await seedFor(operation, "draft");
					const before = await operation.effect(id);

					const outcome = await run(surface, operation, id, {
						afterCheck: () => operation.change(id),
					});

					expect(outcome).toBe("conflict");
					expect(await operation.effect(id)).toEqual(before);
				},
			);
		});

		it("does not condition an Author's duplicate on the entry staying unchanged", async () => {
			const author = { id: CONTRIBUTOR_ID, role: Role.AUTHOR as RoleLevel };
			const duplicate = OPERATIONS.find((operation) => operation.tool === "content_duplicate")!;
			const id = await seedFor(duplicate, "draft");

			const outcome = await run("REST", duplicate, id, {
				user: author,
				afterCheck: () => duplicate.change(id),
			});

			expect(outcome).toBe("done");
		});
	});
});
