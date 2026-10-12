/**
 * Current user query — shared across Shell, Header, Sidebar, and CommandPalette.
 */

import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";

import { apiFetch, parseApiResponse } from "./client.js";

export interface CurrentUser {
	id: string;
	email: string;
	name?: string;
	/** Built-in level; for a custom role, its compatibility level. */
	role: number;
	/** The user's custom role, or null for a built-in role. */
	customRole?: { id: string; slug: string; label: string } | null;
	/** Permission names the user holds in every collection. */
	permissions?: string[];
	/** Content permission names the user holds per collection slug. */
	collections?: Record<string, string[]>;
	avatarUrl?: string;
	isFirstLogin?: boolean;
}

async function fetchCurrentUser(): Promise<CurrentUser> {
	const response = await apiFetch("/_emdash/api/auth/me");
	return parseApiResponse<CurrentUser>(response, i18n._(msg`Failed to fetch user`));
}

export function useCurrentUser() {
	return useQuery({
		queryKey: ["currentUser"],
		queryFn: fetchCurrentUser,
		staleTime: 5 * 60 * 1000,
		retry: false,
	});
}
