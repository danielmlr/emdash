import { describe, expect, it } from "vitest";

// Import source (not package `dist`) so the test tracks edits without a prior `auth` build.
import {
	canActOnOwn as serverCanActOnOwn,
	permissionsForRole,
	type Permission,
} from "../../../auth/src/rbac.js";
import { Role, type RoleLevel } from "../../../auth/src/types.js";
import {
	can,
	canActOnOwn,
	canDuplicateEntry,
	canPublishEntry,
	entryEditAccess,
} from "../../src/lib/permissions.js";

const userWithRole = (role: RoleLevel) => ({
	id: "user_1",
	permissions: permissionsForRole(role),
});

describe("admin permission checks", () => {
	it("answer the ownership pairs like the server for every role and owner", () => {
		const pairs: [Permission, Permission][] = [
			["media:edit_own", "media:edit_any"],
			["media:delete_own", "media:delete_any"],
			["content:edit_own", "content:edit_any"],
			["content:edit_own_drafts", "content:edit_any"],
			["content:publish_own", "content:publish_any"],
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

	it("let a Contributor save only their own entry, and only while it is a draft", () => {
		const contributor = userWithRole(Role.CONTRIBUTOR);
		expect(entryEditAccess(contributor, { authorId: "user_1", status: "draft" })).toBe("draft");
		expect(entryEditAccess(contributor, { authorId: "user_1", status: "published" })).toBeNull();
		expect(entryEditAccess(contributor, { authorId: "user_1", status: "scheduled" })).toBeNull();
		expect(entryEditAccess(contributor, { authorId: "user_2", status: "draft" })).toBeNull();
	});

	it("let an Author save their own entries in any state and an Editor anyone's", () => {
		const author = userWithRole(Role.AUTHOR);
		expect(entryEditAccess(author, { authorId: "user_1", status: "published" })).toBe("full");
		expect(entryEditAccess(author, { authorId: "user_2", status: "draft" })).toBeNull();
		expect(entryEditAccess(author, { authorId: null, status: "draft" })).toBeNull();

		const editor = userWithRole(Role.EDITOR);
		expect(entryEditAccess(editor, { authorId: "user_2", status: "published" })).toBe("full");
		expect(entryEditAccess(editor, { authorId: null, status: "draft" })).toBe("full");
	});

	it("offer publishing and duplicating from the Author role up, for own entries below Editor", () => {
		const own = { authorId: "user_1" };
		const others = { authorId: "user_2" };
		const answers = (role: RoleLevel) => {
			const user = userWithRole(role);
			return [
				canPublishEntry(user, own),
				canPublishEntry(user, others),
				canDuplicateEntry(user, own),
				canDuplicateEntry(user, others),
			];
		};

		expect(answers(Role.CONTRIBUTOR)).toEqual([false, false, false, false]);
		expect(answers(Role.AUTHOR)).toEqual([true, false, true, false]);
		expect(answers(Role.EDITOR)).toEqual([true, true, true, true]);
	});

	it("refuse everything when the payload has no permission list", () => {
		expect(can({}, "content:read")).toBe(false);
		expect(can(undefined, "content:read")).toBe(false);
		expect(canActOnOwn({ id: "user_1" }, "user_1", "media:edit_own", "media:edit_any")).toBe(false);
		expect(entryEditAccess({ id: "user_1" }, { authorId: "user_1", status: "draft" })).toBeNull();
	});
});
