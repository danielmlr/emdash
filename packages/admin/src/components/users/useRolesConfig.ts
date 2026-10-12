import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import * as React from "react";

import { useRoles } from "../../lib/api/roles.js";
import { ROLE_ENTRIES } from "./roleDefinitions.js";

const MSG_ROLE_UNKNOWN = msg`Unknown`;

export type RolesSelectRow = {
	value: number;
	label: string;
	description: string;
};

/**
 * Shared resolved role strings + descriptor rows for selects (after `i18n` is active).
 */
export function useRolesConfig(): {
	roleLabels: Record<string, string>;
	getRoleLabel: (level: number) => string;
	roles: readonly RolesSelectRow[];
} {
	const { t } = useLingui();

	const roles = React.useMemo(
		() =>
			ROLE_ENTRIES.map(({ value, label, description }) => ({
				value,
				label: t(label),
				description: t(description),
			})),
		[t],
	);

	const roleLabels = React.useMemo(
		() => Object.fromEntries(ROLE_ENTRIES.map((r) => [String(r.value), t(r.label)])),
		[t],
	);

	const getRoleLabel = React.useCallback(
		(level: number) => roleLabels[String(level)] ?? t(MSG_ROLE_UNKNOWN),
		[roleLabels, t],
	);

	return { roleLabels, getRoleLabel, roles };
}

export type RoleOption = {
	/** `"10"`–`"50"` for a built-in role, `"custom:<id>"` for a custom role. */
	key: string;
	label: string;
	description: string;
};

const CUSTOM_PREFIX = "custom:";

/** The option key for a user's current role. */
export function roleKeyFor(user: { role: number; customRole?: { id: string } | null }): string {
	return user.customRole ? `${CUSTOM_PREFIX}${user.customRole.id}` : String(user.role);
}

/** Turn an option key back into what the users and invite APIs accept. */
export function parseRoleKey(key: string): { role?: number; roleId?: string } {
	if (key.startsWith(CUSTOM_PREFIX)) return { roleId: key.slice(CUSTOM_PREFIX.length) };
	return { role: Number.parseInt(key, 10) };
}

/**
 * Built-in roles followed by the site's custom roles, for role pickers.
 */
export function useRoleOptions(options: { enabled: boolean }): {
	options: readonly RoleOption[];
	labels: Record<string, string>;
} {
	const { t } = useLingui();
	const { roles } = useRolesConfig();
	const { data } = useRoles(options.enabled);

	return React.useMemo(() => {
		const all: RoleOption[] = [
			...roles.map((role) => ({
				key: String(role.value),
				label: role.label,
				description: role.description,
			})),
			...(data?.items ?? []).map((role) => ({
				key: `${CUSTOM_PREFIX}${role.id}`,
				label: role.label,
				description: role.description || t(MSG_CUSTOM_ROLE),
			})),
		];
		return {
			options: all,
			labels: Object.fromEntries(all.map((option) => [option.key, option.label])),
		};
	}, [data?.items, roles, t]);
}

const MSG_CUSTOM_ROLE = msg`Custom role`;
