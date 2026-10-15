import { Toasty } from "@cloudflare/kumo";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeProvider } from "../src/components/ThemeProvider";
import type { AdminManifest } from "../src/lib/api";
import { createAdminRouter } from "../src/router";
import { builtInUser } from "./utils/permissions.ts";
import { render } from "./utils/render.tsx";
import { createMockFetch, createTestQueryClient } from "./utils/test-helpers";

const MANIFEST: AdminManifest = {
	version: "1.0.0",
	hash: "abc123",
	authMode: "passkey",
	collections: {
		posts: {
			label: "Posts",
			labelSingular: "Post",
			supports: [],
			hasSeo: false,
			fields: { title: { kind: "string", label: "Title" } },
		},
	},
	plugins: {},
	taxonomies: [],
	i18n: undefined,
};

function post(status: "draft" | "published") {
	return {
		id: "post_1",
		type: "posts",
		slug: "my-post",
		status,
		locale: "en",
		translationGroup: null,
		data: { title: "My post" },
		authorId: "user_01",
		primaryBylineId: null,
		createdAt: "2025-01-01T00:00:00Z",
		updatedAt: "2025-01-01T00:00:00Z",
		publishedAt: status === "published" ? "2025-01-01T00:00:00Z" : null,
		scheduledAt: null,
		liveRevisionId: null,
		draftRevisionId: null,
	};
}

async function openOwnPost(
	mockFetch: ReturnType<typeof createMockFetch>,
	status: "draft" | "published",
) {
	mockFetch.on("GET", "/_emdash/api/content/posts/post_1", { data: { item: post(status) } });
	const queryClient = createTestQueryClient();
	const router = createAdminRouter(queryClient);
	if (!i18n.locale) i18n.loadAndActivate({ locale: "en", messages: {} });
	await router.navigate({
		to: "/content/$collection/$id",
		params: { collection: "posts", id: "post_1" },
	});
	return render(
		<I18nProvider i18n={i18n}>
			<ThemeProvider defaultTheme="light">
				<Toasty>
					<QueryClientProvider client={queryClient}>
						<RouterProvider router={router} />
					</QueryClientProvider>
				</Toasty>
			</ThemeProvider>
		</I18nProvider>,
	);
}

describe("ContentEditPage – a Contributor's own entry", () => {
	let mockFetch: ReturnType<typeof createMockFetch>;

	beforeEach(() => {
		mockFetch = createMockFetch();
		mockFetch
			.on("GET", "/_emdash/api/manifest", { data: MANIFEST })
			.on("GET", "/_emdash/api/auth/me", { data: builtInUser(20, "user_01") })
			.on("GET", "/_emdash/api/bylines", { data: { items: [] } })
			.on("POST", "/_emdash/api/content/posts/post_1/lock", {
				data: { enabled: false, holder: null, heldByCaller: false },
			});
	});

	afterEach(() => {
		mockFetch.restore();
	});

	it("is editable while it is a draft", async () => {
		const screen = await openOwnPost(mockFetch, "draft");
		await expect.element(screen.getByLabelText("Title")).toHaveValue("My post");
		await expect.element(screen.getByLabelText("Title")).toBeEnabled();
	});

	it("is read-only once it is published", async () => {
		const screen = await openOwnPost(mockFetch, "published");
		await expect.element(screen.getByLabelText("Title")).toHaveValue("My post");
		await expect.element(screen.getByLabelText("Title")).toBeDisabled();
	});
});
