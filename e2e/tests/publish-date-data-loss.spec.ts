/**
 * Repro: saving a publish date discards editor edits that are not yet on the
 * server.
 *
 * The publish-date write invalidates the entry query, the editor refetches, and
 * the effect that syncs item -> formData resets the form to server state. The
 * same chain was fixed for autosave in #295/#302; the publish-date path was
 * added later and does not have the guard.
 *
 * Not for submission as-is: this file exists to observe the bug.
 */

import { test, expect } from "../fixtures";

test.describe("Publish date data loss", () => {
	let collectionSlug: string;
	let postId: string;
	let headers: Record<string, string>;
	let baseUrl: string;

	test.beforeEach(async ({ admin, serverInfo }) => {
		await admin.devBypassAuth();

		baseUrl = serverInfo.baseUrl;
		headers = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${serverInfo.token}`,
			"X-EmDash-Request": "1",
			Origin: baseUrl,
		};

		collectionSlug = `pubdate_${Date.now()}`;
		await fetch(`${baseUrl}/_emdash/api/schema/collections`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				slug: collectionSlug,
				label: "Publish Date Test",
				labelSingular: "Publish Date Test",
				supports: ["revisions", "drafts"],
			}),
		});
		await fetch(`${baseUrl}/_emdash/api/schema/collections/${collectionSlug}/fields`, {
			method: "POST",
			headers,
			body: JSON.stringify({ slug: "title", type: "string", label: "Title", required: true }),
		});

		const createRes = await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}`, {
			method: "POST",
			headers,
			body: JSON.stringify({ data: { title: "Original" }, slug: "pubdate-test" }),
		});
		const createData: any = await createRes.json();
		postId = createData.data?.item?.id ?? createData.data?.id;

		await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}/publish`, {
			method: "POST",
			headers,
			body: JSON.stringify({}),
		});
	});

	test.afterEach(async () => {
		await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}`, {
			method: "DELETE",
			headers,
		}).catch(() => {});
		await fetch(`${baseUrl}/_emdash/api/schema/collections/${collectionSlug}`, {
			method: "DELETE",
			headers,
		}).catch(() => {});
	});

	async function serverTitle(): Promise<string> {
		const res = await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}`, {
			headers,
		});
		const body: any = await res.json();
		return body.data?.item?.data?.title ?? body.data?.data?.title;
	}

	async function changePublishTime(admin: any) {
		await admin.page.getByRole("button", { name: /Change publication date/ }).click();
		const minute = admin.page.getByLabel("Minute");
		await expect(minute).toBeVisible();
		const current = await minute.inputValue();
		const next = String((Number(current) + 7) % 60).padStart(2, "0");
		await minute.fill(next);
		const save = admin.page.getByRole("button", { name: "Save date" });
		await expect(save).toBeEnabled();
		await save.click();
	}

	test("edits survive a publish-date save while autosave is failing", async ({ admin }) => {
		const contentUrl = `/_emdash/api/content/${collectionSlug}/${postId}`;
		let autosaveRejections = 0;

		// Autosave is unreachable (offline, 5xx, or a rejected payload): the only
		// copy of the edit is the form.
		await admin.page.route(`**${contentUrl}*`, async (route) => {
			const request = route.request();
			if (request.method() !== "PUT") return route.continue();
			const body = request.postDataJSON();
			if (body?.skipRevision) {
				autosaveRejections++;
				return route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({
						error: { code: "SERVER_ERROR", message: "Simulated autosave outage" },
					}),
				});
			}
			return route.continue();
		});

		await admin.goToEditContent(collectionSlug, postId);
		await admin.waitForLoading();

		const titleInput = admin.page.locator("#field-title");
		await expect(titleInput).toHaveValue("Original");

		await titleInput.fill("Rescued Title");
		await expect.poll(() => autosaveRejections, { timeout: 10000 }).toBeGreaterThan(0);

		// The edit is genuinely unsaved.
		expect(await serverTitle()).toBe("Original");
		await expect(titleInput).toHaveValue("Rescued Title");

		const publishedAtPut = admin.page.waitForResponse(
			(res: any) =>
				res.url().includes(contentUrl) && res.request().method() === "PUT" && res.status() < 400,
			{ timeout: 15000 },
		);
		await changePublishTime(admin);
		await publishedAtPut;
		await admin.page.waitForTimeout(1500);

		await admin.page.screenshot({
			path: "/tmp/publish-date-data-loss.png",
			fullPage: false,
		});

		await expect(titleInput).toHaveValue("Rescued Title");
	});

	test("edits survive a publish-date save inside the autosave debounce", async ({ admin }) => {
		const contentUrl = `/_emdash/api/content/${collectionSlug}/${postId}`;
		let autosaves = 0;
		admin.page.on("request", (request: any) => {
			if (request.url().includes(contentUrl) && request.method() === "PUT") {
				if (request.postDataJSON()?.skipRevision) autosaves++;
			}
		});

		await admin.goToEditContent(collectionSlug, postId);
		await admin.waitForLoading();

		const titleInput = admin.page.locator("#field-title");
		await expect(titleInput).toHaveValue("Original");

		// No interception: race the 2 s debounce the way a fast editor would.
		await titleInput.fill("Beat The Debounce");
		await changePublishTime(admin);
		await admin.page.waitForTimeout(2500);
		await admin.page.screenshot({ path: "/tmp/publish-date-data-loss.png" });

		// If autosave won the race the run proves nothing; only assert when the
		// edit was still unsaved at the moment the date was saved.
		test.skip(autosaves > 0, "autosave fired before the date was saved");
		await expect(titleInput).toHaveValue("Beat The Debounce");
	});

	test("control: nothing else resets the form while autosave is failing", async ({ admin }) => {
		const contentUrl = `/_emdash/api/content/${collectionSlug}/${postId}`;
		await admin.page.route(`**${contentUrl}*`, async (route) => {
			const request = route.request();
			if (request.method() === "PUT" && request.postDataJSON()?.skipRevision) {
				return route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({
						error: { code: "SERVER_ERROR", message: "Simulated autosave outage" },
					}),
				});
			}
			return route.continue();
		});

		await admin.goToEditContent(collectionSlug, postId);
		await admin.waitForLoading();

		const titleInput = admin.page.locator("#field-title");
		await titleInput.fill("Still Here");
		await admin.page.waitForTimeout(5000);

		await expect(titleInput).toHaveValue("Still Here");
	});
});
