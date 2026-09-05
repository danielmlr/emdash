import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ApiResponseError } from "../../src/lib/api/client";
import type { EntryLockStatus } from "../../src/lib/api/entry-lock";
import { useEntryLock } from "../../src/lib/useEntryLock";
import { render } from "../utils/render.tsx";

const acquireEntryLock = vi.fn<(...args: unknown[]) => Promise<EntryLockStatus>>();
const releaseEntryLock = vi.fn<(...args: unknown[]) => Promise<void>>();

vi.mock("../../src/lib/api/entry-lock.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/lib/api/entry-lock.js")>();
	return {
		...actual,
		acquireEntryLock: (...args: unknown[]) => acquireEntryLock(...args),
		releaseEntryLock: (...args: unknown[]) => releaseEntryLock(...args),
	};
});

const ADA = {
	userId: "user-ada",
	userName: "Ada",
	acquiredAt: "2026-09-04T10:00:00.000Z",
	expiresAt: "2026-09-04T10:07:00.000Z",
};

/** Renders the hook's state so assertions read it out of the DOM. */
function Probe() {
	const lock = useEntryLock({ collection: "posts", entryId: "entry-1", ready: true });
	const [lastReport, setLastReport] = React.useState("");
	return (
		<div>
			<span data-testid="status">{lock.state.status}</span>
			<span data-testid="read-only">{String(lock.readOnly)}</span>
			<span data-testid="last-report">{lastReport}</span>
			<button type="button" onClick={lock.readInstead}>
				read instead
			</button>
			<button type="button" onClick={lock.takeOver}>
				take over
			</button>
			<button
				type="button"
				onClick={() =>
					setLastReport(
						String(
							lock.reportWriteError(
								new ApiResponseError(409, "ENTRY_LOCKED", "held", ADA),
								"entry-1",
							),
						),
					)
				}
			>
				report refusal
			</button>
			<button
				type="button"
				onClick={() =>
					setLastReport(
						String(
							lock.reportWriteError(new ApiResponseError(409, "CONFLICT", "stale"), "entry-1"),
						),
					)
				}
			>
				report conflict
			</button>
			<button
				type="button"
				onClick={() =>
					setLastReport(
						String(
							lock.reportWriteError(
								new ApiResponseError(409, "ENTRY_LOCKED", "held", ADA),
								"a-different-entry",
							),
						),
					)
				}
			>
				refusal for another entry
			</button>
		</div>
	);
}

describe("useEntryLock", () => {
	beforeEach(() => {
		acquireEntryLock.mockReset();
		releaseEntryLock.mockReset();
		releaseEntryLock.mockResolvedValue(undefined);
	});

	it("holds the entry when the lock is granted", async () => {
		acquireEntryLock.mockResolvedValue({ enabled: true, heldByCaller: true, holder: ADA });

		const screen = await render(<Probe />);

		await expect.element(screen.getByTestId("status")).toHaveTextContent("holding");
		await expect.element(screen.getByTestId("read-only")).toHaveTextContent("false");
	});

	it("blocks the editor when someone else holds it, until they choose to read", async () => {
		acquireEntryLock.mockResolvedValue({ enabled: true, heldByCaller: false, holder: ADA });

		const screen = await render(<Probe />);

		await expect.element(screen.getByTestId("status")).toHaveTextContent("blocked");
		await expect.element(screen.getByTestId("read-only")).toHaveTextContent("true");

		await screen.getByRole("button", { name: "read instead" }).click();
		await expect.element(screen.getByTestId("status")).toHaveTextContent("reading");
		await expect.element(screen.getByTestId("read-only")).toHaveTextContent("true");
	});

	it("asks for a take-over explicitly", async () => {
		acquireEntryLock.mockResolvedValueOnce({ enabled: true, heldByCaller: false, holder: ADA });
		acquireEntryLock.mockResolvedValueOnce({
			enabled: true,
			heldByCaller: true,
			holder: { ...ADA, userId: "user-me", userName: "Me" },
		});

		const screen = await render(<Probe />);
		await expect.element(screen.getByTestId("status")).toHaveTextContent("blocked");

		await screen.getByRole("button", { name: "take over" }).click();

		await expect.element(screen.getByTestId("status")).toHaveTextContent("holding");
		expect(acquireEntryLock).toHaveBeenLastCalledWith(
			"posts",
			"entry-1",
			expect.objectContaining({ takeover: true }),
		);
	});

	it("switches to read-only when a save is refused by someone else's lock", async () => {
		acquireEntryLock.mockResolvedValue({ enabled: true, heldByCaller: true, holder: ADA });

		const screen = await render(<Probe />);
		await expect.element(screen.getByTestId("status")).toHaveTextContent("holding");

		await screen.getByRole("button", { name: "report refusal" }).click();

		await expect.element(screen.getByTestId("last-report")).toHaveTextContent("true");
		await expect.element(screen.getByTestId("status")).toHaveTextContent("taken");
		await expect.element(screen.getByTestId("read-only")).toHaveTextContent("true");
	});

	it("leaves every other failure to the caller's own error handling", async () => {
		acquireEntryLock.mockResolvedValue({ enabled: true, heldByCaller: true, holder: ADA });

		const screen = await render(<Probe />);
		await expect.element(screen.getByTestId("status")).toHaveTextContent("holding");

		await screen.getByRole("button", { name: "report conflict" }).click();

		await expect.element(screen.getByTestId("last-report")).toHaveTextContent("false");
		await expect.element(screen.getByTestId("status")).toHaveTextContent("holding");
	});

	it("ignores a refusal that arrives after the editor moved to another entry", async () => {
		acquireEntryLock.mockResolvedValue({ enabled: true, heldByCaller: true, holder: ADA });

		const screen = await render(<Probe />);
		await expect.element(screen.getByTestId("status")).toHaveTextContent("holding");

		await screen.getByRole("button", { name: "refusal for another entry" }).click();

		await expect.element(screen.getByTestId("last-report")).toHaveTextContent("true");
		await expect.element(screen.getByTestId("status")).toHaveTextContent("holding");
		await expect.element(screen.getByTestId("read-only")).toHaveTextContent("false");
	});

	it("takes no lock and stays editable when the collection has locking off", async () => {
		acquireEntryLock.mockResolvedValue({ enabled: false, heldByCaller: false, holder: null });

		const screen = await render(<Probe />);

		await expect.element(screen.getByTestId("status")).toHaveTextContent("disabled");
		await expect.element(screen.getByTestId("read-only")).toHaveTextContent("false");
	});

	it("hands the lock back on unmount, but only when it held one", async () => {
		acquireEntryLock.mockResolvedValue({ enabled: true, heldByCaller: true, holder: ADA });
		const held = await render(<Probe />);
		await expect.element(held.getByTestId("status")).toHaveTextContent("holding");
		await held.unmount();
		await vi.waitFor(() => {
			expect(releaseEntryLock).toHaveBeenCalledTimes(1);
		});

		releaseEntryLock.mockClear();
		acquireEntryLock.mockResolvedValue({ enabled: true, heldByCaller: false, holder: ADA });
		const blocked = await render(<Probe />);
		await expect.element(blocked.getByTestId("status")).toHaveTextContent("blocked");
		await blocked.unmount();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(releaseEntryLock).not.toHaveBeenCalled();
	});
});
