import { Role, type RoleLevel } from "@emdash-cms/auth";
import type { APIRoute } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	DELETE as deleteAllowedDomain,
	PATCH as updateAllowedDomain,
} from "../../../src/astro/routes/api/admin/allowed-domains/[domain].js";
import {
	GET as listAllowedDomains,
	POST as createAllowedDomain,
} from "../../../src/astro/routes/api/admin/allowed-domains/index.js";
import { DELETE as revokeApiToken } from "../../../src/astro/routes/api/admin/api-tokens/[id].js";
import {
	GET as listApiTokens,
	POST as createApiToken,
} from "../../../src/astro/routes/api/admin/api-tokens/index.js";
import {
	DELETE as deleteOAuthClient,
	GET as getOAuthClient,
	PUT as updateOAuthClient,
} from "../../../src/astro/routes/api/admin/oauth-clients/[id].js";
import {
	GET as listOAuthClients,
	POST as createOAuthClient,
} from "../../../src/astro/routes/api/admin/oauth-clients/index.js";
import { POST as disableUser } from "../../../src/astro/routes/api/admin/users/[id]/disable.js";
import { POST as enableUser } from "../../../src/astro/routes/api/admin/users/[id]/enable.js";
import {
	GET as getUser,
	PUT as updateUser,
} from "../../../src/astro/routes/api/admin/users/[id]/index.js";
import { POST as sendRecovery } from "../../../src/astro/routes/api/admin/users/[id]/send-recovery.js";
import { GET as listUsers } from "../../../src/astro/routes/api/admin/users/index.js";
import { POST as createInvite } from "../../../src/astro/routes/api/auth/invite/index.js";
import type { Database } from "../../../src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

interface RouteCase {
	name: string;
	handler: APIRoute;
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	path: string;
	params?: Record<string, string>;
}

const ROUTES: RouteCase[] = [
	{ name: "list users", handler: listUsers, method: "GET", path: "admin/users" },
	{
		name: "read a user",
		handler: getUser,
		method: "GET",
		path: "admin/users/missing",
		params: { id: "missing" },
	},
	{
		name: "update a user",
		handler: updateUser,
		method: "PUT",
		path: "admin/users/missing",
		params: { id: "missing" },
	},
	{
		name: "enable a user",
		handler: enableUser,
		method: "POST",
		path: "admin/users/missing/enable",
		params: { id: "missing" },
	},
	{
		name: "disable a user",
		handler: disableUser,
		method: "POST",
		path: "admin/users/missing/disable",
		params: { id: "missing" },
	},
	{
		name: "send a recovery link",
		handler: sendRecovery,
		method: "POST",
		path: "admin/users/missing/send-recovery",
		params: { id: "missing" },
	},
	{
		name: "list allowed domains",
		handler: listAllowedDomains,
		method: "GET",
		path: "admin/allowed-domains",
	},
	{
		name: "add an allowed domain",
		handler: createAllowedDomain,
		method: "POST",
		path: "admin/allowed-domains",
	},
	{
		name: "update an allowed domain",
		handler: updateAllowedDomain,
		method: "PATCH",
		path: "admin/allowed-domains/missing.example.com",
		params: { domain: "missing.example.com" },
	},
	{
		name: "delete an allowed domain",
		handler: deleteAllowedDomain,
		method: "DELETE",
		path: "admin/allowed-domains/missing.example.com",
		params: { domain: "missing.example.com" },
	},
	{ name: "list API tokens", handler: listApiTokens, method: "GET", path: "admin/api-tokens" },
	{
		name: "create an API token",
		handler: createApiToken,
		method: "POST",
		path: "admin/api-tokens",
	},
	{
		name: "revoke an API token",
		handler: revokeApiToken,
		method: "DELETE",
		path: "admin/api-tokens/missing",
		params: { id: "missing" },
	},
	{
		name: "list OAuth clients",
		handler: listOAuthClients,
		method: "GET",
		path: "admin/oauth-clients",
	},
	{
		name: "create an OAuth client",
		handler: createOAuthClient,
		method: "POST",
		path: "admin/oauth-clients",
	},
	{
		name: "read an OAuth client",
		handler: getOAuthClient,
		method: "GET",
		path: "admin/oauth-clients/missing",
		params: { id: "missing" },
	},
	{
		name: "update an OAuth client",
		handler: updateOAuthClient,
		method: "PUT",
		path: "admin/oauth-clients/missing",
		params: { id: "missing" },
	},
	{
		name: "delete an OAuth client",
		handler: deleteOAuthClient,
		method: "DELETE",
		path: "admin/oauth-clients/missing",
		params: { id: "missing" },
	},
	{ name: "create an invite", handler: createInvite, method: "POST", path: "auth/invite" },
];

describe("user, token and OAuth client routes", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabase();
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	function call(route: RouteCase, role: RoleLevel) {
		const url = new URL(`/_emdash/api/${route.path}`, "https://site.example.com");
		const hasBody = route.method !== "GET" && route.method !== "DELETE";
		const context = {
			url,
			params: route.params ?? {},
			request: new Request(url, {
				method: route.method,
				headers: { "Content-Type": "application/json" },
				...(hasBody ? { body: "{}" } : {}),
			}),
			locals: {
				emdash: { db, config: { siteUrl: url.origin } },
				user: { id: `user-${role}`, role },
			},
		};
		// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- minimal route context
		return route.handler(context as unknown as Parameters<APIRoute>[0]);
	}

	it.each(ROUTES)("refuses an Editor: $name", async (route) => {
		const response = await call(route, Role.EDITOR);

		expect(response.status).toBe(403);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("FORBIDDEN");
	});

	it.each(ROUTES)("lets an Admin past the permission check: $name", async (route) => {
		const response = await call(route, Role.ADMIN);

		expect([401, 403]).not.toContain(response.status);
	});
});
