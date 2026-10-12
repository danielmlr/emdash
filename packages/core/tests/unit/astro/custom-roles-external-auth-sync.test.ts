/**
 * External auth role sync leaves a user with a custom role alone: the level
 * column keeps the role's compatibility level, so code that compares numbers
 * never sees the provider's level for such a user.
 */

import { Role, clampScopes, hasPermission } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleRoleCreate } from "../../../src/api/handlers/roles.js";
import { GET as listOAuthClients } from "../../../src/astro/routes/api/admin/oauth-clients/index.js";
import type { Database } from "../../../src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

vi.mock("astro:middleware", () => ({
	defineMiddleware: (handler: unknown) => handler,
}));

const { authenticate } = vi.hoisted(() => ({
	authenticate: vi.fn(async () => ({
		email: "jobs@example.com",
		name: "Jobs Person",
		role: 50,
		subject: "access-user",
	})),
}));

vi.mock("virtual:emdash/auth", () => ({ authenticate }), { virtual: true });
vi.mock("virtual:emdash/config", () => ({ default: {} }), { virtual: true });
vi.mock("../../../src/astro/session-user.js", () => ({
	resolveSessionUser: vi.fn(async () => null),
}));

let onRequest: typeof import("../../../src/astro/middleware/auth.js").onRequest;

beforeAll(async () => {
	vi.stubEnv("DEV", false);
	({ onRequest } = await import("../../../src/astro/middleware/auth.js"));
});

afterAll(() => {
	vi.unstubAllEnvs();
});

const JOBS_EDITOR_GRANTS = {
	permissions: ["media:read", "media:upload", "taxonomies:read"],
	collections: {
		jobs: ["content:read", "content:read_drafts", "content:create", "content:edit_any"],
	},
};

async function request(db: Kysely<Database>, config: Record<string, unknown>) {
	const locals: Record<string, unknown> = {
		emdash: {
			db,
			config: {
				auth: {
					type: "cloudflare-access",
					entrypoint: "@emdash-cms/cloudflare/auth",
					config: { teamDomain: "example.cloudflareaccess.com", ...config },
				},
			},
			getPluginRouteMeta: vi.fn(() => ({ public: false })),
		},
	};
	const url = new URL("/_emdash/api/plugins/example/config", "https://example.com");
	const context = {
		request: new Request(url, { headers: { "Cf-Access-Jwt-Assertion": "access-jwt" } }),
		url,
		locals,
		session: { get: vi.fn(async () => null), set: vi.fn() },
		redirect: vi.fn(),
	};
	const response = await onRequest(context as never, async () => new Response("ok"));
	expect(response.status).toBe(200);
	return locals;
}

describe("external auth role sync with a custom role", () => {
	let db: Kysely<Database>;
	let roleId: string;

	beforeEach(async () => {
		db = await setupTestDatabase();
		const created = await handleRoleCreate(db, {
			slug: "jobs-editor",
			label: "Jobs editor",
			...JOBS_EDITOR_GRANTS,
		});
		if (!created.success) throw new Error(created.error.message);
		roleId = created.data.item.id;
		const now = new Date().toISOString();
		await db
			.insertInto("users")
			.values({
				id: "user-1",
				email: "jobs@example.com",
				name: "Jobs Person",
				role: created.data.item.compatibilityLevel,
				role_id: roleId,
				email_verified: 1,
				created_at: now,
				updated_at: now,
			})
			.execute();
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await teardownTestDatabase(db);
	});

	it("keeps the compatibility level of a custom role when the provider reports another level", async () => {
		await request(db, { syncRoles: true });

		const row = await db
			.selectFrom("users")
			.select(["role", "role_id"])
			.where("id", "=", "user-1")
			.executeTakeFirstOrThrow();
		expect(row.role_id).toBe(roleId);
		expect(row.role).toBe(Role.SUBSCRIBER);
	});

	it("keeps number-comparing routes and clamps closed for the custom role", async () => {
		await request(db, { syncRoles: true });
		const user = (await createKyselyAdapter(db).getUserById("user-1"))!;

		// Permission checks still answer from the grants.
		expect(hasPermission(user, "auth:manage_connections")).toBe(false);
		expect(hasPermission(user, "users:manage")).toBe(false);

		expect(await createKyselyAdapter(db).countAdmins()).toBe(0);
		const response = await listOAuthClients({
			locals: { emdash: { db }, user },
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal APIContext
		} as never);
		expect(response.status).toBe(403);
		expect(clampScopes(["admin", "schema:write"], user.role)).toEqual([]);
	});
});
