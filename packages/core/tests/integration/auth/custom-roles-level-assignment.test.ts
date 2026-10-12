/**
 * The compatibility level written on assignment is read from the role row
 * inside the write, so a role edit that commits between an assignment's
 * check and its write cannot leave a user or invite above the level the
 * role is worth.
 */

import { Role, permissionsForRole, type User } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as roles from "../../../src/api/handlers/roles.js";
import { PUT as putUser } from "../../../src/astro/routes/api/admin/users/[id]/index.js";
import { POST as postInvite } from "../../../src/astro/routes/api/auth/invite/index.js";
import type { Database } from "../../../src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

// The role is narrowed right after the pre-check reads it, which is what a
// concurrent role edit does from the assignment's point of view.
const narrowedOnce = { done: false };
vi.mock("../../../src/api/handlers/roles.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../src/api/handlers/roles.js")>();
	return {
		...actual,
		findRoleForAssignment: async (
			db: Kysely<Database>,
			id: string,
			options?: { forUpdate?: boolean },
		) => {
			const result = await actual.findRoleForAssignment(db, id, options);
			if (!db.isTransaction && !narrowedOnce.done) {
				narrowedOnce.done = true;
				const narrowed = await actual.handleRoleUpdate(db, id, { permissions: ["content:read"] });
				if (!narrowed.success) throw new Error(narrowed.error.message);
			}
			return result;
		},
	};
});

let db: Kysely<Database>;
let admin: User;
let roleId: string;

function ctx(opts: { user: User; params?: Record<string, string>; method: string; body: unknown }) {
	const url = new URL("http://localhost/_emdash/api/test");
	return {
		params: opts.params ?? {},
		url,
		request: new Request(url, {
			method: opts.method,
			headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
			body: JSON.stringify(opts.body),
		}),
		locals: { user: opts.user, emdash: { db, config: {} } },
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal APIContext
	} as unknown as APIContext;
}

beforeEach(async () => {
	narrowedOnce.done = false;
	db = await setupTestDatabase();
	const adapter = createKyselyAdapter(db);
	admin = await adapter.createUser({ email: "admin@test.com", role: Role.ADMIN });
	const created = await roles.handleRoleCreate(db, {
		slug: "editor-like",
		label: "Editor like",
		permissions: permissionsForRole(Role.EDITOR),
	});
	if (!created.success) throw new Error(created.error.message);
	expect(created.data.item.compatibilityLevel).toBe(Role.EDITOR);
	roleId = created.data.item.id;
});

afterEach(async () => {
	await teardownTestDatabase(db);
});

describe("a role narrowed while it is being assigned", () => {
	it("stores the narrowed level on the user", async () => {
		const target = await createKyselyAdapter(db).createUser({
			email: "target@test.com",
			role: Role.SUBSCRIBER,
		});
		const res = await putUser(
			ctx({ user: admin, params: { id: target.id }, method: "PUT", body: { roleId } }),
		);
		expect(res.status).toBe(200);
		expect(narrowedOnce.done).toBe(true);
		const row = await db
			.selectFrom("users")
			.select(["role", "role_id"])
			.where("id", "=", target.id)
			.executeTakeFirstOrThrow();
		expect(row).toEqual({ role: Role.SUBSCRIBER, role_id: roleId });
	});

	it("stores the narrowed level on the invite", async () => {
		const res = await postInvite(
			ctx({ user: admin, method: "POST", body: { email: "new@test.com", roleId } }),
		);
		expect(res.status, await res.text()).toBe(200);
		expect(narrowedOnce.done).toBe(true);
		const row = await db
			.selectFrom("auth_tokens")
			.select(["role", "role_id"])
			.where("email", "=", "new@test.com")
			.executeTakeFirstOrThrow();
		expect(row).toEqual({ role: Role.SUBSCRIBER, role_id: roleId });
	});
});

describe("deleting a role", () => {
	it("ignores invites that have expired", async () => {
		await db
			.insertInto("auth_tokens")
			.values({
				hash: "expired-invite-hash",
				user_id: null,
				email: "invitee@test.com",
				type: "invite",
				role: Role.SUBSCRIBER,
				role_id: roleId,
				invited_by: admin.id,
				expires_at: new Date(Date.now() - 86_400_000).toISOString(),
			})
			.execute();
		const result = await roles.handleRoleDelete(db, roleId);
		expect(result.success).toBe(true);
	});
});
