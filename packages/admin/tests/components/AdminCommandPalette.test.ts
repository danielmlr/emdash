import { Browser, ClockCounterClockwise, Download, Files, Newspaper } from "@phosphor-icons/react";
import { describe, expect, it } from "vitest";

import { buildNavItems } from "../../src/components/AdminCommandPalette";
import { permissionsFor } from "../utils/permissions.js";

function canAs(role: number) {
	const held = permissionsFor(role);
	return (permission: string) => held.includes(permission);
}

describe("buildNavItems", () => {
	it("uses collection overrides and the default collection icon", () => {
		const items = buildNavItems(
			{
				collections: {
					pages: { label: "Pages" },
					posts: { label: "Posts" },
					products: { label: "Products" },
				},
				plugins: {},
			},
			canAs(50),
			(id) => id,
		);

		expect(items.find((item) => item.id === "collection-pages")?.icon).toBe(Browser);
		expect(items.find((item) => item.id === "collection-posts")?.icon).toBe(Newspaper);
		expect(items.find((item) => item.id === "collection-products")?.icon).toBe(Files);
		expect(items.find((item) => item.id === "import")?.icon).toBe(Download);
	});

	it("offers the calendar to contributors and above", () => {
		const manifest = { collections: {}, plugins: {} };

		expect(
			buildNavItems(manifest, canAs(20), (id) => id).find((item) => item.id === "calendar"),
		).toMatchObject({
			to: "/calendar",
		});
		expect(
			buildNavItems(manifest, canAs(10), (id) => id).some((item) => item.id === "calendar"),
		).toBe(false);
	});

	it("offers each built-in role the destinations its level offered before", () => {
		const manifest = { collections: {}, plugins: {} };
		const ids = (role: number) =>
			buildNavItems(manifest, canAs(role), (id) => id).map((item) => item.id);

		const subscriber = ["dashboard", "media"];
		const contributor = ["dashboard", "calendar", "media"];
		const editor = [
			"dashboard",
			"calendar",
			"media",
			"menus",
			"widgets",
			"sections",
			"categories",
			"tags",
		];
		expect(ids(10)).toEqual(subscriber);
		expect(ids(20)).toEqual(contributor);
		expect(ids(30)).toEqual(contributor);
		expect(ids(40)).toEqual(editor);
		expect(ids(50)).toEqual([
			"dashboard",
			"calendar",
			"media",
			"menus",
			"widgets",
			"sections",
			"content-types",
			"categories",
			"tags",
			"users",
			"plugins",
			"import",
			"settings",
			"transfer",
			"security",
		]);
	});

	it("leaves built-in areas hidden by the site config out of the results", () => {
		const builtIn = ["calendar", "media", "menus", "widgets", "sections", "import"];
		const manifest = { collections: {}, plugins: {} };

		const shown = buildNavItems(manifest, canAs(50), (id) => id).map((item) => item.id);
		const hidden = buildNavItems(
			{ ...manifest, admin: { hiddenNavItems: builtIn } },
			canAs(50),
			(id) => id,
		).map((item) => item.id);

		expect(shown).toEqual(expect.arrayContaining(builtIn));
		for (const id of builtIn) expect(hidden).not.toContain(id);
		expect(hidden).toContain("settings");
	});

	it("leaves hidden collections out of the navigation links", () => {
		const items = buildNavItems(
			{
				collections: {
					posts: { label: "Posts" },
					sync_runs: { label: "Sync runs", hidden: true },
				},
				plugins: {},
			},
			canAs(50),
			(id) => id,
		);

		expect(items.some((item) => item.id === "collection-posts")).toBe(true);
		expect(items.some((item) => item.id === "collection-sync_runs")).toBe(false);
	});

	it("uses a plugin page's declared icon", () => {
		const items = buildNavItems(
			{
				collections: {},
				plugins: {
					"audit-log": {
						enabled: true,
						adminPages: [{ path: "/history", label: "Audit History", icon: "history" }],
					},
				},
			},
			canAs(50),
			(id) => id,
		);

		expect(items.find((item) => item.id === "plugin-audit-log-/history")?.icon).toBe(
			ClockCounterClockwise,
		);
	});

	it("builds a navigable route for a plugin page declared without a leading slash", () => {
		const items = buildNavItems(
			{
				collections: {},
				plugins: {
					"audit-log": {
						enabled: true,
						adminPages: [{ path: "history", label: "Audit History" }],
					},
				},
			},
			canAs(50),
			(id) => id,
		);

		expect(items.find((item) => item.id === "plugin-audit-log-history")?.to).toBe(
			"/plugins/audit-log/history",
		);
	});

	it("keeps a native plugin root page in navigation", () => {
		const items = buildNavItems(
			{
				collections: {},
				plugins: {
					"emdash-forms": {
						enabled: true,
						adminPages: [{ path: "/", label: "Forms" }],
					},
				},
			},
			canAs(50),
			(id) => id,
		);

		expect(items.find((item) => item.id === "plugin-emdash-forms-/")?.to).toBe(
			"/plugins/emdash-forms/",
		);
	});
});
