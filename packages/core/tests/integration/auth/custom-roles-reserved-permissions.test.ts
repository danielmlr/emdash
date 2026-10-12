/**
 * settings:manage sets the site URL that every sign-in link is built from, so
 * a custom role can never hold it, whatever its stored grants say.
 */

import { Role, hasPermission, normalizeGrants, type User } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleRoleCreate } from "../../../src/api/handlers/roles.js";
import { getSiteBaseUrl } from "../../../src/api/site-url.js";
import { POST as postSettings } from "../../../src/astro/routes/api/settings.js";
import { OptionsRepository } from "../../../src/database/repositories/options.js";
import type { Database } from "../../../src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

let db: Kysely<Database>;
let settingsManager: User;

beforeEach(async () => {
	db = await setupTestDatabase();
	const adapter = createKyselyAdapter(db);
	const created = await handleRoleCreate(db, {
		slug: "site-settings",
		label: "Site settings",
		permissions: ["settings:read"],
	});
	if (!created.success) throw new Error(created.error.message);
	// Whatever a stored role says, the grants that reach checks drop the name.
	await db
		.updateTable("_emdash_roles")
		.set({
			grants: JSON.stringify({
				permissions: ["settings:read", "settings:manage"],
				collections: {},
			}),
		})
		.where("id", "=", created.data.item.id)
		.execute();
	const row = await adapter.createUser({
		email: "settings@test.com",
		role: created.data.item.compatibilityLevel,
		roleId: created.data.item.id,
	});
	settingsManager = (await adapter.getUserById(row.id))!;
	// The site has been set up on its real origin.
	await new OptionsRepository(db).set("emdash:site_url", "https://real.example");
});

afterEach(async () => {
	await teardownTestDatabase(db);
});

describe("settings:manage in a custom role", () => {
	it("is refused by the grant rules because it controls where sign-in links go", () => {
		const grants = normalizeGrants({ permissions: ["settings:read", "settings:manage"] });
		expect(grants.permissions).toEqual(["settings:read"]);
		expect(settingsManager.role).toBe(Role.SUBSCRIBER);
		expect(hasPermission(settingsManager, "settings:manage")).toBe(false);
		expect(hasPermission(settingsManager, "users:manage")).toBe(false);
	});

	it("lets the role point magic-link, invite and recovery links at another origin", async () => {
		const request = new Request("https://real.example/_emdash/api/settings", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
			body: JSON.stringify({ url: "https://attacker.example" }),
		});
		const response = await postSettings({
			request,
			url: new URL(request.url),
			locals: { user: settingsManager, emdash: { db, storage: undefined, config: {} } },
			cache: { enabled: false, invalidate: vi.fn() },
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal APIContext
		} as unknown as APIContext);
		// The base every sign-in email link is built from (magic-link/send.ts,
		// invite/index.ts, send-recovery.ts, signup/request.ts) stays on the real
		// origin because no custom role can hold settings:manage.
		const base = await getSiteBaseUrl(db, new Request("https://real.example/"), {});
		expect(base).toBe("https://real.example/_emdash");
		expect(response.status).toBe(403);
	});
});
