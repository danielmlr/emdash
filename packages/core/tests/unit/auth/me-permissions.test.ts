import { Role, type RoleLevel } from "@emdash-cms/auth";
import { describe, expect, it } from "vitest";

import { GET } from "../../../src/astro/routes/api/auth/me.js";

async function permissionsOf(role: RoleLevel): Promise<string[]> {
	const response = await GET({
		locals: { user: { id: "user-1", email: "user@example.com", name: "User", role, data: {} } },
	} as unknown as Parameters<typeof GET>[0]);
	const body = (await response.json()) as { data: { permissions: string[] } };
	return body.data.permissions;
}

describe("GET /_emdash/api/auth/me permissions", () => {
	it("lists what an Author may do and leaves out what needs an Editor", async () => {
		const permissions = await permissionsOf(Role.AUTHOR);

		expect(permissions).toEqual(
			expect.arrayContaining(["content:read", "content:publish_own", "media:edit_own"]),
		);
		expect(permissions).not.toContain("content:publish_any");
		expect(permissions).not.toContain("media:edit_any");
		expect(permissions).not.toContain("users:read");
	});

	it("follows the role of the signed-in user", async () => {
		expect(await permissionsOf(Role.SUBSCRIBER)).not.toContain("content:create");
		expect(await permissionsOf(Role.ADMIN)).toEqual(
			expect.arrayContaining(["content:create", "users:manage", "settings:manage"]),
		);
	});
});
