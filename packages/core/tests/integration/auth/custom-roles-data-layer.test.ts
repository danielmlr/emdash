/**
 * Migration 092 and the role join on every supported dialect.
 */

import { Role, compatibilityLevel, hasPermission } from "@emdash-cms/auth";
import { createKyselyAdapter, parseGrants } from "@emdash-cms/auth/adapters/kysely";
import { sql } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
	handleRoleCreate,
	handleRoleDelete,
	handleRoleUpdate,
} from "../../../src/api/handlers/roles.js";
import { columnExists, tableExists } from "../../../src/database/dialect-helpers.js";
import { down, up } from "../../../src/database/migrations/092_custom_roles.js";
import {
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

const GRANTS = {
	permissions: ["media:read", "media:upload", "taxonomies:read"],
	collections: {
		jobs: ["content:read", "content:read_drafts", "content:create", "content:edit_any"],
	},
};

describeEachDialect("custom roles data layer", (dialect) => {
	let ctx: DialectTestContext;

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	it("migration 092 restarts after any completed statement and reverts cleanly", async () => {
		const { db } = ctx;
		// Already applied by setup: a second run must be a no-op, not an error.
		await expect(up(db)).resolves.toBeUndefined();
		expect(await tableExists(db, "_emdash_roles")).toBe(true);
		expect(await columnExists(db, "users", "role_id")).toBe(true);
		expect(await columnExists(db, "auth_tokens", "role_id")).toBe(true);
		expect(await columnExists(db, "allowed_domains", "default_role_id")).toBe(true);

		// Partial state: table present, one column missing, index missing.
		await db.schema.dropIndex("idx_auth_tokens_role_id").ifExists().execute();
		await db.schema.alterTable("auth_tokens").dropColumn("role_id").execute();
		await expect(up(db)).resolves.toBeUndefined();
		expect(await columnExists(db, "auth_tokens", "role_id")).toBe(true);

		await expect(down(db)).resolves.toBeUndefined();
		expect(await tableExists(db, "_emdash_roles")).toBe(false);
		expect(await columnExists(db, "users", "role_id")).toBe(false);
		await expect(up(db)).resolves.toBeUndefined();
		expect(await columnExists(db, "users", "role_id")).toBe(true);
	});

	it("enforces the role foreign key", async () => {
		const { db } = ctx;
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

	it("loads the role with the user in getUserById, getUserByEmail, getUserWithDetails and getUsers", async () => {
		const { db } = ctx;
		const adapter = createKyselyAdapter(db);
		const created = await handleRoleCreate(db, { slug: "jobs-editor", label: "Jobs", ...GRANTS });
		if (!created.success) throw new Error(created.error.message);
		const user = await adapter.createUser({
			email: "sam@test.com",
			role: created.data.item.compatibilityLevel,
			roleId: created.data.item.id,
		});
		expect(user.customRole?.slug).toBe("jobs-editor");

		const byId = await adapter.getUserById(user.id);
		const byEmail = await adapter.getUserByEmail("sam@test.com");
		const details = await adapter.getUserWithDetails(user.id);
		const listed = await adapter.getUsers({ limit: 10 });
		for (const loaded of [
			byId,
			byEmail,
			details?.user,
			listed.items.find((u) => u.id === user.id),
		]) {
			expect(loaded?.customRole?.grants.collections.jobs).toContain("content:edit_own");
			expect(hasPermission(loaded, "content:edit_any", { collection: "jobs" })).toBe(true);
			expect(hasPermission(loaded, "content:edit_any", { collection: "posts" })).toBe(false);
			expect(hasPermission(loaded, "content:read")).toBe(false);
		}
	});

	it("rewrites stored levels on update and refuses deletion while referenced", async () => {
		const { db } = ctx;
		const adapter = createKyselyAdapter(db);
		const created = await handleRoleCreate(db, { slug: "r", label: "R", ...GRANTS });
		if (!created.success) throw new Error(created.error.message);
		const roleId = created.data.item.id;
		const user = await adapter.createUser({ email: "x@test.com", role: 10, roleId });
		await db
			.insertInto("auth_tokens")
			.values({
				hash: "h1",
				user_id: null,
				email: "y@test.com",
				type: "invite",
				role: 10,
				role_id: roleId,
				invited_by: null,
				expires_at: new Date(Date.now() + 3_600_000).toISOString(),
			})
			.execute();

		const widened = await handleRoleUpdate(db, roleId, {
			permissions: [
				...GRANTS.permissions,
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
			],
		});
		expect(widened.success && widened.data.item.compatibilityLevel).toBe(Role.AUTHOR);
		const userRow = await db
			.selectFrom("users")
			.select("role")
			.where("id", "=", user.id)
			.executeTakeFirstOrThrow();
		const inviteRow = await db
			.selectFrom("auth_tokens")
			.select("role")
			.where("hash", "=", "h1")
			.executeTakeFirstOrThrow();
		expect(userRow.role).toBe(Role.AUTHOR);
		expect(inviteRow.role).toBe(Role.AUTHOR);
		const roleRow = await db
			.selectFrom("_emdash_roles")
			.select("grants")
			.where("id", "=", roleId)
			.executeTakeFirstOrThrow();
		expect(compatibilityLevel(parseGrants(roleRow.grants))).toBe(Role.AUTHOR);

		const refused = await handleRoleDelete(db, roleId);
		expect(refused.success).toBe(false);
	});

	it("treats broken grants JSON as no permissions", async () => {
		const { db } = ctx;
		const adapter = createKyselyAdapter(db);
		const created = await handleRoleCreate(db, { slug: "broken", label: "Broken", ...GRANTS });
		if (!created.success) throw new Error(created.error.message);
		await sql`UPDATE _emdash_roles SET grants = ${"{not json"} WHERE id = ${created.data.item.id}`.execute(
			db,
		);
		const user = await adapter.createUser({
			email: "b@test.com",
			role: 10,
			roleId: created.data.item.id,
		});
		const loaded = await adapter.getUserById(user.id);
		expect(loaded?.customRole?.grants).toEqual({ permissions: [], collections: {} });
		expect(hasPermission(loaded, "content:read", { collection: "jobs" })).toBe(false);
		expect(hasPermission(loaded, "media:read")).toBe(false);
	});
});
