import { Browser, ClockCounterClockwise, Download, Files, Newspaper } from "@phosphor-icons/react";
import { describe, expect, it } from "vitest";

import { buildNavItems } from "../../src/components/AdminCommandPalette";
import { builtInUser, checksFor, customRoleUser } from "../utils/permissions.ts";

const admin = checksFor(builtInUser(50));

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
			admin,
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
			buildNavItems(manifest, checksFor(builtInUser(20)), (id) => id).find(
				(item) => item.id === "calendar",
			),
		).toMatchObject({
			to: "/calendar",
		});
		expect(
			buildNavItems(manifest, checksFor(builtInUser(10)), (id) => id).some(
				(item) => item.id === "calendar",
			),
		).toBe(false);
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
			admin,
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
			admin,
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
			admin,
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
			admin,
			(id) => id,
		);

		expect(items.find((item) => item.id === "plugin-emdash-forms-/")?.to).toBe(
			"/plugins/emdash-forms/",
		);
	});

	it("offers a collection-scoped role only its collections and nothing it cannot open", () => {
		const jobsEditor = checksFor(
			customRoleUser({
				permissions: ["media:read"],
				collections: { jobs: ["content:read", "content:read_drafts", "content:edit_any"] },
			}),
		);
		const ids = buildNavItems(
			{ collections: { jobs: { label: "Jobs" }, posts: { label: "Posts" } }, plugins: {} },
			jobsEditor,
			(id) => id,
		).map((item) => item.id);

		expect(ids).toEqual(["dashboard", "calendar", "collection-jobs", "media"]);
	});
});
