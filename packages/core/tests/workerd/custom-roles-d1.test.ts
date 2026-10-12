import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { env } from "cloudflare:test";
import { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RawBindingD1Dialect } from "../../../cloudflare/src/db/d1-dialect.js";
import {
	handleRoleCreate,
	handleRoleDelete,
	handleRoleUpdate,
} from "../../src/api/handlers/roles.js";
import { runMigrations } from "../../src/database/migrations/runner.js";
import type { Database } from "../../src/database/types.js";
import { resetD1Schema } from "./d1-schema.js";

declare module "cloudflare:test" {
	interface ProvidedEnv {
		DB: D1Database;
	}
}

let db: Kysely<Database>;

beforeAll(() => {
	db = new Kysely<Database>({ dialect: new RawBindingD1Dialect({ database: env.DB }) });
});

beforeEach(async () => {
	await resetD1Schema(db);
	await runMigrations(db);
});

afterAll(async () => {
	await db.destroy();
});

describe("custom roles on D1", () => {
	it("rewrites the stored level of users and invites when the role changes", async () => {
		const created = await handleRoleCreate(db, {
			slug: "jobs-editor",
			label: "Jobs editor",
			collections: { jobs: ["content:read", "content:edit_any"] },
		});
		if (!created.success) throw new Error(created.error.message);
		const roleId = created.data.item.id;
		const adapter = createKyselyAdapter(db);
		const user = await adapter.createUser({ email: "sam@test.com", role: 10, roleId });
		await db
			.insertInto("auth_tokens")
			.values({
				hash: "invite-1",
				user_id: null,
				email: "pat@test.com",
				type: "invite",
				role: 10,
				role_id: roleId,
				invited_by: user.id,
				expires_at: new Date(Date.now() + 3_600_000).toISOString(),
			})
			.execute();

		const widened = await handleRoleUpdate(db, roleId, {
			permissions: [
				"content:read",
				"content:read_drafts",
				"content:create",
				"content:edit_own",
				"content:delete_own",
				"content:publish_own",
				"media:read",
				"media:upload",
				"media:edit_own",
				"media:delete_own",
				"taxonomies:read",
				"comments:read",
				"menus:read",
				"bylines:read",
				"widgets:read",
				"sections:read",
				"search:read",
				"auth:manage_own_credentials",
			],
		});
		expect(widened.success && widened.data.item.compatibilityLevel).toBe(30);

		const userRow = await db
			.selectFrom("users")
			.select("role")
			.where("id", "=", user.id)
			.executeTakeFirstOrThrow();
		const inviteRow = await db
			.selectFrom("auth_tokens")
			.select("role")
			.where("hash", "=", "invite-1")
			.executeTakeFirstOrThrow();
		expect(userRow.role).toBe(30);
		expect(inviteRow.role).toBe(30);

		const loaded = await adapter.getUserById(user.id);
		expect(loaded?.customRole?.grants.permissions).toContain("content:create");

		const refused = await handleRoleDelete(db, roleId);
		expect(refused.success).toBe(false);
	});

	it("enforces the role foreign key", async () => {
		const now = new Date().toISOString();
		await expect(
			db
				.insertInto("users")
				.values({
					id: "u-fk",
					email: "fk@test.com",
					role: 10,
					role_id: "no-such-role",
					email_verified: 1,
					created_at: now,
					updated_at: now,
				})
				.execute(),
		).rejects.toThrow();
	});
});
