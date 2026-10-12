/**
 * Custom roles API
 */

import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";

import { API_BASE, apiFetch, parseApiResponse, throwResponseError } from "./client.js";

/** A custom role: site-wide permissions plus content permissions per collection. */
export interface CustomRoleItem {
	id: string;
	slug: string;
	label: string;
	description: string | null;
	permissions: string[];
	collections: Record<string, string[]>;
	/** Built-in level that code comparing role numbers sees for this role. */
	compatibilityLevel: number;
	userCount: number;
	createdAt: string;
	updatedAt: string;
}

/** One permission name with what the role editor needs to know about it. */
export interface PermissionCatalogEntry {
	name: string;
	/** Lowest built-in role that holds the permission. */
	minRole: number;
	/** Whether a custom role can hold it for chosen collections only. */
	collectionScoped: boolean;
	/** Whether only the built-in Admin role can hold it. */
	builtInAdminOnly: boolean;
}

export interface RoleList {
	items: CustomRoleItem[];
	permissions: PermissionCatalogEntry[];
}

export interface RoleInput {
	slug?: string;
	label: string;
	description?: string | null;
	permissions: string[];
	collections: Record<string, string[]>;
}

export async function fetchRoles(): Promise<RoleList> {
	const response = await apiFetch(`${API_BASE}/admin/roles`);
	return parseApiResponse<RoleList>(response, i18n._(msg`Failed to load roles`));
}

export async function createRole(input: RoleInput & { slug: string }): Promise<CustomRoleItem> {
	const response = await apiFetch(`${API_BASE}/admin/roles`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const data = await parseApiResponse<{ item: CustomRoleItem }>(
		response,
		i18n._(msg`Failed to create role`),
	);
	return data.item;
}

export async function updateRole(id: string, input: RoleInput): Promise<CustomRoleItem> {
	const { slug: _slug, ...body } = input;
	const response = await apiFetch(`${API_BASE}/admin/roles/${id}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = await parseApiResponse<{ item: CustomRoleItem }>(
		response,
		i18n._(msg`Failed to update role`),
	);
	return data.item;
}

export async function deleteRole(id: string): Promise<void> {
	const response = await apiFetch(`${API_BASE}/admin/roles/${id}`, { method: "DELETE" });
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to delete role`));
}

/** Custom roles and the permission catalog; only loaded when `enabled`. */
export function useRoles(enabled = true) {
	return useQuery({
		queryKey: ["roles"],
		queryFn: fetchRoles,
		enabled,
		staleTime: 60 * 1000,
	});
}
