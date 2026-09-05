import * as React from "react";

import {
	acquireEntryLock,
	entryLockRefusal,
	releaseEntryLock,
	type EntryLockHolder,
} from "./api/entry-lock.js";

export type EntryLockState =
	/** The first acquire has not answered yet. */
	| { status: "pending" }
	/** The collection does not take edit locks. */
	| { status: "disabled" }
	/** This session holds the lock. */
	| { status: "holding" }
	/** Someone else holds it and the editor has not chosen what to do. */
	| { status: "blocked"; holder: EntryLockHolder }
	/** Someone else holds it and the editor chose to read. */
	| { status: "reading"; holder: EntryLockHolder }
	/** Someone took the lock while this session had it. */
	| { status: "taken"; holder: EntryLockHolder };

export interface EntryLock {
	state: EntryLockState;
	/** Whether the editor must not accept edits. */
	readOnly: boolean;
	takeOver: () => void;
	readInstead: () => void;
	isTakingOver: boolean;
	/**
	 * Report a failed write. Returns true when the lock explains the failure,
	 * which also switches the editor to read-only. `entryId` is the entry the
	 * write was for; a refusal that arrives after the editor moved on is
	 * ignored rather than applied to whatever is open now.
	 */
	reportWriteError: (error: unknown, entryId: string) => boolean;
}

const IDLE: EntryLockState = { status: "pending" };

export function useEntryLock(input: {
	collection: string;
	entryId: string;
	locale?: string;
	/** Hold off until the entry has loaded and the id is known to resolve. */
	ready: boolean;
}): EntryLock {
	const { collection, entryId, locale, ready } = input;
	const [state, setState] = React.useState<EntryLockState>(IDLE);
	const [isTakingOver, setIsTakingOver] = React.useState(false);
	// Release only what this session actually took, so a read-only viewer
	// never drops the holder's lock on the way out.
	const holdsLockRef = React.useRef(false);
	// The editor stays mounted across an entry or locale switch, so an answer
	// that was asked for before the switch must not land on what is open now.
	const generationRef = React.useRef(0);

	React.useEffect(() => {
		if (!ready) return;

		generationRef.current += 1;
		let cancelled = false;
		setState(IDLE);
		setIsTakingOver(false);
		holdsLockRef.current = false;

		void (async () => {
			try {
				const status = await acquireEntryLock(collection, entryId, { locale });
				if (cancelled) return;
				if (!status.enabled) {
					setState({ status: "disabled" });
				} else if (status.heldByCaller || !status.holder) {
					holdsLockRef.current = status.heldByCaller;
					setState({ status: "holding" });
				} else {
					setState({ status: "blocked", holder: status.holder });
				}
			} catch {
				// A lock that cannot be taken must not stop the editor from
				// opening; the write path still refuses a conflicting save.
				if (!cancelled) setState({ status: "disabled" });
			}
		})();

		return () => {
			cancelled = true;
			if (!holdsLockRef.current) return;
			holdsLockRef.current = false;
			void releaseEntryLock(collection, entryId, { locale }).catch(() => undefined);
		};
	}, [collection, entryId, locale, ready]);

	const takeOver = React.useCallback(() => {
		const generation = generationRef.current;
		setIsTakingOver(true);
		void (async () => {
			try {
				const status = await acquireEntryLock(collection, entryId, { locale, takeover: true });
				if (!status.heldByCaller) return;
				if (generation !== generationRef.current) {
					// The editor moved on while the take-over was in flight. Hand back
					// what it just took rather than holding a lock nobody is using.
					await releaseEntryLock(collection, entryId, { locale }).catch(() => undefined);
					return;
				}
				holdsLockRef.current = true;
				setState({ status: "holding" });
			} catch {
				// Leave the notice standing; the editor can try again.
			} finally {
				if (generation === generationRef.current) setIsTakingOver(false);
			}
		})();
	}, [collection, entryId, locale]);

	const readInstead = React.useCallback(() => {
		setState((previous) =>
			previous.status === "blocked" ? { status: "reading", holder: previous.holder } : previous,
		);
	}, []);

	const reportWriteError = React.useCallback(
		(error: unknown, writtenEntryId: string) => {
			const holder = entryLockRefusal(error);
			if (!holder) return false;
			if (writtenEntryId !== entryId) return true;
			holdsLockRef.current = false;
			setState({ status: "taken", holder });
			return true;
		},
		[entryId],
	);

	return {
		state,
		readOnly: state.status === "blocked" || state.status === "reading" || state.status === "taken",
		takeOver,
		readInstead,
		isTakingOver,
		reportWriteError,
	};
}
