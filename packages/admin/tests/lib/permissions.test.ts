import { describe, expect, it } from "vitest";

// Import source (not package `dist`) so the test tracks edits without a prior `auth` build.
import {
	canActOnOwn as serverCanActOnOwn,
	permissionsForRole,
	type Permission,
} from "../../../auth/src/rbac.js";
import { Role } from "../../../auth/src/types.js";
import { can, canActOnOwn } from "../../src/lib/permissions.js";

describe("admin permission checks", () => {
	it("answer the ownership pairs like the server for every role and owner", () => {
		const pairs: [Permission, Permission][] = [
			["media:edit_own", "media:edit_any"],
			["media:delete_own", "media:delete_any"],
			["content:edit_own", "content:edit_any"],
		];
		for (const role of Object.values(Role)) {
			const user = { id: "user_1", permissions: permissionsForRole(role) };
			for (const [ownerId, serverOwnerId] of [
				["user_1", "user_1"],
				["user_2", "user_2"],
				[null, ""],
				["", ""],
			] as const) {
				for (const [own, any] of pairs) {
					expect({
						role,
						ownerId,
						own,
						allowed: canActOnOwn(user, ownerId, own, any),
					}).toEqual({
						role,
						ownerId,
						own,
						allowed: serverCanActOnOwn({ id: "user_1", role }, serverOwnerId, own, any),
					});
				}
			}
		}
	});

	it("refuse everything when the payload has no permission list", () => {
		expect(can({}, "content:read")).toBe(false);
		expect(can(undefined, "content:read")).toBe(false);
		expect(canActOnOwn({ id: "user_1" }, "user_1", "media:edit_own", "media:edit_any")).toBe(false);
	});
});
