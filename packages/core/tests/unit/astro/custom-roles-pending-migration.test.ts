/**
 * New code serving requests against a database where migration 092 has not
 * run yet (migration mode `manual`) or stopped after creating the roles
 * table: the user lookups fall back to the plain select, so sessions keep
 * working until the migration lands.
 */

import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { down as revertCustomRoles } from "../../../src/database/migrations/092_custom_roles.js";
import type { Database } from "../../../src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

vi.mock("astro:middleware", () => ({
	defineMiddleware: (handler: unknown) => handler,
}));
vi.mock("virtual:emdash/auth", () => ({ authenticate: vi.fn() }), { virtual: true });
vi.mock("virtual:emdash/config", () => ({ default: {} }), { virtual: true });
vi.mock("../../../src/astro/session-user.js", () => ({
	resolveSessionUser: vi.fn(async () => ({ id: "user-1" })),
}));

let onRequest: typeof import("../../../src/astro/middleware/auth.js").onRequest;

beforeAll(async () => {
	vi.stubEnv("DEV", false);
	({ onRequest } = await import("../../../src/astro/middleware/auth.js"));
});

afterAll(() => {
	vi.unstubAllEnvs();
});

describe("user lookup before migration 092 has run", () => {
	it("does not swallow a missing users table", async () => {
		await db.schema.dropTable("users").execute();
		await expect(createKyselyAdapter(db).getUserById("user-1")).rejects.toThrow(/users/);
	});

	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabase();
		await revertCustomRoles(db);
		const now = new Date().toISOString();
		await db
			.insertInto("users")
			.values({
				id: "user-1",
				email: "admin@example.com",
				name: "Admin",
				role: 50,
				email_verified: 1,
				created_at: now,
				updated_at: now,
			} as never)
			.execute();
		vi.spyOn(console, "error").mockImplementation(() => {});
		// The fallback is remembered process-wide for a minute; each test starts without it.
		delete (globalThis as Record<symbol, unknown>)[Symbol.for("emdash:auth:role-join-failed-at")];
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await teardownTestDatabase(db);
	});

	it("still resolves a user with a built-in role", async () => {
		// Red on poc/custom-roles: the LEFT JOIN has no fallback when the table is missing.
		await expect(createKyselyAdapter(db).getUserById("user-1")).resolves.toMatchObject({
			id: "user-1",
			role: 50,
		});
	});

	it("still resolves a user when 092 stopped after creating the roles table", async () => {
		await db.schema
			.createTable("_emdash_roles")
			.addColumn("id", "text", (col) => col.primaryKey())
			.addColumn("slug", "text", (col) => col.notNull().unique())
			.addColumn("label", "text", (col) => col.notNull())
			.addColumn("description", "text")
			.addColumn("grants", "text", (col) => col.notNull())
			.addColumn("created_at", "text", (col) => col.notNull())
			.addColumn("updated_at", "text", (col) => col.notNull())
			.execute();
		await expect(createKyselyAdapter(db).getUserById("user-1")).resolves.toMatchObject({
			id: "user-1",
			role: 50,
		});
	});

	it("lists users, and none for a custom role", async () => {
		const adapter = createKyselyAdapter(db);
		const listed = await adapter.getUsers();
		expect(listed.items.map((user) => user.id)).toEqual(["user-1"]);
		expect((await adapter.getUsers({ roleId: "any-role" })).items).toEqual([]);
	});

	it("serves a signed-in admin API request", async () => {
		const url = new URL("/_emdash/api/dashboard", "https://example.com");
		const context = {
			request: new Request(url),
			url,
			locals: { emdash: { db, config: {} } },
			session: { get: vi.fn(async () => ({ id: "user-1" })), set: vi.fn(), destroy: vi.fn() },
			redirect: vi.fn(
				(to: string) => new Response(null, { status: 302, headers: { location: to } }),
			),
		};
		const response = await onRequest(context as never, async () => new Response("ok"));
		expect(response.status).toBe(200);
	});
});
