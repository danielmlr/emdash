import { Role } from "@emdash-cms/auth";
import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import { POST as createTranslation } from "../../../src/astro/routes/api/admin/bylines/[id]/translations.js";
import { POST as createByline } from "../../../src/astro/routes/api/admin/bylines/index.js";
import { resolveBylineCredits } from "../../../src/bylines/credits.js";
import { resetBylineFieldDefsCacheForTests } from "../../../src/bylines/field-defs-cache.js";
import { BylineRepository } from "../../../src/database/repositories/byline.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import { UserRepository } from "../../../src/database/repositories/user.js";
import type { Database } from "../../../src/database/types.js";
import { setI18nConfig } from "../../../src/i18n/config.js";
import { HookPipeline } from "../../../src/plugins/hooks.js";
import { BylineSchemaRegistry } from "../../../src/schema/byline-registry.js";
import {
	describeEachDialect,
	setupForDialectWithCollections,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

interface BylineJson {
	data: { id: string; userId: string | null; customFields?: Record<string, unknown> };
	error?: { code: string; message: string };
}

describeEachDialect("byline translations keep the user link", (dialect) => {
	let ctx: DialectTestContext;
	let db: Kysely<Database>;
	let bylines: BylineRepository;
	let userId: string;

	function post(route: typeof createByline, path: string, body: unknown, id?: string) {
		const request = new Request(`http://localhost/_emdash/api/admin/bylines${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
			body: JSON.stringify(body),
		});
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stub for tests
		const context = {
			params: id ? { id } : {},
			url: new URL(request.url),
			request,
			locals: {
				emdash: { db, hooks: new HookPipeline([], { db }), config: {} },
				user: { id: "admin", role: Role.ADMIN },
			},
		} as unknown as APIContext;
		return route(context);
	}

	function translate(id: string, body: unknown) {
		return post(createTranslation, `/${id}/translations`, body, id);
	}

	beforeEach(async () => {
		ctx = await setupForDialectWithCollections(dialect);
		db = ctx.db;
		bylines = new BylineRepository(db);
		resetBylineFieldDefsCacheForTests();
		setI18nConfig({ defaultLocale: "en", locales: ["en", "fr", "de"] });
		const user = await new UserRepository(db).create({
			email: "ada@example.com",
			displayName: "Ada",
			role: "author",
		});
		userId = user.id;
	});

	afterEach(async () => {
		setI18nConfig(null);
		await teardownForDialect(ctx);
	});

	it("credits the author's entries in the new locale after translating their byline", async () => {
		const source = await bylines.create({
			slug: "ada",
			displayName: "Ada Lovelace",
			userId,
			locale: "en",
		});

		const res = await translate(source.id, { locale: "fr" });
		expect(res.status).toBe(201);
		const translation = ((await res.json()) as BylineJson).data;
		expect(translation.userId).toBe(userId);

		const entry = await new ContentRepository(db).create({
			type: "post",
			slug: "bonjour",
			data: { title: "Bonjour" },
			locale: "fr",
			authorId: userId,
		});
		const credits = await resolveBylineCredits(db, "post", [
			{ id: entry.id, authorId: userId, locale: "fr" },
		]);
		expect(credits.get(entry.id)).toMatchObject([
			{ source: "inferred", byline: { id: translation.id, locale: "fr" } },
		]);
	});

	it("rejects a translation when the user already has another byline in that locale", async () => {
		const source = await bylines.create({
			slug: "ada",
			displayName: "Ada Lovelace",
			userId,
			locale: "en",
		});
		await bylines.create({ slug: "ada-alt", displayName: "A. Lovelace", userId, locale: "fr" });

		const res = await translate(source.id, { locale: "fr" });
		expect(res.status).toBe(409);
		expect(((await res.json()) as BylineJson).error?.code).toBe("CONFLICT");

		const group = await bylines.findByTranslationGroup(source.translationGroup ?? source.id);
		expect(group.map((b) => b.locale)).toEqual(["en"]);
	});

	it("keeps the source's user on POST /bylines with translationOf unless the body sets userId", async () => {
		const source = await bylines.create({
			slug: "ada",
			displayName: "Ada Lovelace",
			userId,
			locale: "en",
		});

		const unlinked = await post(createByline, "", {
			slug: "ada",
			displayName: "Ada Lovelace",
			locale: "fr",
			translationOf: source.id,
			userId: null,
		});
		expect(unlinked.status).toBe(201);
		expect(((await unlinked.json()) as BylineJson).data.userId).toBeNull();

		const inherited = await post(createByline, "", {
			slug: "ada",
			displayName: "Ada Lovelace",
			locale: "de",
			translationOf: source.id,
		});
		expect(inherited.status).toBe(201);
		expect(((await inherited.json()) as BylineJson).data.userId).toBe(userId);
	});

	it("completes a retried create for a linked user", async () => {
		await new BylineSchemaRegistry(db).createField({
			slug: "job_title",
			label: "Job title",
			type: "string",
			translatable: true,
		});
		// The row a first attempt leaves behind when it dies before the
		// custom-field writes (D1 has no transactions).
		const partial = await bylines.create({
			slug: "ada",
			displayName: "Ada Lovelace",
			userId,
			locale: "en",
		});

		const res = await post(createByline, "", {
			slug: "ada",
			displayName: "Ada Lovelace",
			userId,
			locale: "en",
			customFields: { job_title: "Mathematician" },
		});
		expect(res.status).toBe(201);
		const json = (await res.json()) as BylineJson;
		expect(json.data.id).toBe(partial.id);
		expect(json.data.customFields).toMatchObject({ job_title: "Mathematician" });
	});
});
