import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { permissionsFor } from "../utils/permissions.js";
import { render } from "../utils/render.tsx";

// Role levels from @emdash-cms/auth.
const ROLE_AUTHOR = 30;
const ROLE_EDITOR = 40;
const ROLE_ADMIN = 50;

const currentUser = vi.hoisted(() => ({
	role: 50 as number,
	isLoading: false,
	signedIn: true,
}));

vi.mock("../../src/lib/api/current-user.js", () => ({
	useCurrentUser: () => ({
		data: currentUser.signedIn
			? {
					id: "user-1",
					email: "user@example.com",
					role: currentUser.role,
					permissions: permissionsFor(currentUser.role),
				}
			: undefined,
		isLoading: currentUser.isLoading,
	}),
}));

// Import after mocks
const { RequirePermission } = await import("../../src/components/RequirePermission.js");

const CHILD_TEXT = "Protected settings content";

describe("RequirePermission", () => {
	beforeEach(() => {
		currentUser.role = ROLE_ADMIN;
		currentUser.isLoading = false;
		currentUser.signedIn = true;
	});

	it("renders its children for an admin", async () => {
		const screen = await render(
			<RequirePermission permission="settings:manage">
				<p>{CHILD_TEXT}</p>
			</RequirePermission>,
		);
		await expect.element(screen.getByText(CHILD_TEXT)).toBeInTheDocument();
		await expect.element(screen.getByText("Access denied")).not.toBeInTheDocument();
	});

	it.each([
		["editor", ROLE_EDITOR],
		["author", ROLE_AUTHOR],
	])("shows Access denied instead of its children for an %s", async (_label, role) => {
		currentUser.role = role;
		const screen = await render(
			<RequirePermission permission="settings:manage">
				<p>{CHILD_TEXT}</p>
			</RequirePermission>,
		);
		await expect.element(screen.getByText("Access denied")).toBeInTheDocument();
		await expect.element(screen.getByText(CHILD_TEXT)).not.toBeInTheDocument();
	});

	it("renders its children for an editor when editors hold the permission", async () => {
		currentUser.role = ROLE_EDITOR;
		const screen = await render(
			<RequirePermission permission="comments:moderate">
				<p>{CHILD_TEXT}</p>
			</RequirePermission>,
		);
		await expect.element(screen.getByText(CHILD_TEXT)).toBeInTheDocument();
		await expect.element(screen.getByText("Access denied")).not.toBeInTheDocument();
	});

	it("treats a missing user as denied", async () => {
		currentUser.signedIn = false;
		const screen = await render(
			<RequirePermission permission="settings:manage">
				<p>{CHILD_TEXT}</p>
			</RequirePermission>,
		);
		await expect.element(screen.getByText("Access denied")).toBeInTheDocument();
		await expect.element(screen.getByText(CHILD_TEXT)).not.toBeInTheDocument();
	});

	it("renders neither children nor the denial while the user is loading", async () => {
		currentUser.isLoading = true;
		currentUser.signedIn = false;
		const screen = await render(
			<RequirePermission permission="settings:manage">
				<p>{CHILD_TEXT}</p>
			</RequirePermission>,
		);
		await expect.element(screen.getByText(CHILD_TEXT)).not.toBeInTheDocument();
		await expect.element(screen.getByText("Access denied")).not.toBeInTheDocument();
	});
});
