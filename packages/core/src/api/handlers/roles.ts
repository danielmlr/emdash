/**
 * Custom role handlers
 *
 * A custom role is a named set of existing permissions. Content permissions
 * can be limited to chosen collections. Users, invites and signup domains
 * that reference a role store its compatibility level in their role column,
 * so code that still compares role numbers never sees more than the role
 * grants (apart from the Subscriber floor).
 */

import {
	ALL_PERMISSIONS,
	BUILT_IN_ADMIN_ONLY_PERMISSIONS,
	COLLECTION_SCOPED_PERMISSIONS,
	Permissions,
	compatibilityLevel,
	isPermission,
	normalizeGrants,
	type RoleGrants,
	type RoleLevel,
} from "@emdash-cms/auth";
import { parseGrants } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";
import { ulid } from "ulidx";

import { executeAtomicBatchIfSupported, isPostgres } from "../../database/dialect-helpers.js";
import { withTransaction } from "../../database/transaction.js";
import type { Database } from "../../database/types.js";
import type { ApiResult } from "../types.js";

export interface RoleItem {
	id: string;
	slug: string;
	label: string;
	description: string | null;
	permissions: string[];
	collections: Record<string, string[]>;
	compatibilityLevel: RoleLevel;
	userCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface PermissionCatalogEntry {
	name: string;
	minRole: RoleLevel;
	collectionScoped: boolean;
	builtInAdminOnly: boolean;
}

export interface RoleInput {
	permissions?: string[];
	collections?: Record<string, string[]>;
}

/** Every permission name with what the role editor needs to know about it. */
export function permissionCatalog(): PermissionCatalogEntry[] {
	return ALL_PERMISSIONS.map((name) => ({
		name,
		minRole: Permissions[name],
		collectionScoped: COLLECTION_SCOPED_PERMISSIONS.has(name),
		builtInAdminOnly: BUILT_IN_ADMIN_ONLY_PERMISSIONS.has(name),
	}));
}

/**
 * Reject names a stored role would silently lose, so an Admin never saves a
 * role that grants less than the form showed.
 */
export function validateGrantInput(input: RoleInput): string | null {
	for (const name of input.permissions ?? []) {
		if (!isPermission(name)) return `Unknown permission: ${name}`;
		if (BUILT_IN_ADMIN_ONLY_PERMISSIONS.has(name)) {
			return `Only the built-in Admin role can hold ${name}`;
		}
	}
	for (const [collection, names] of Object.entries(input.collections ?? {})) {
		for (const name of names) {
			if (!isPermission(name)) return `Unknown permission: ${name}`;
			if (!COLLECTION_SCOPED_PERMISSIONS.has(name)) {
				return `${name} cannot be limited to a collection (${collection})`;
			}
		}
	}
	return null;
}

type RoleRow = Database["_emdash_roles"];

function toItem(row: RoleRow, userCount: number): RoleItem {
	const grants = parseGrants(row.grants);
	return {
		id: row.id,
		slug: row.slug,
		label: row.label,
		description: row.description,
		permissions: grants.permissions,
		collections: grants.collections,
		compatibilityLevel: compatibilityLevel(grants),
		userCount,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function countUsersByRole(db: Kysely<Database>): Promise<Map<string, number>> {
	const rows = await db
		.selectFrom("users")
		.select(["role_id", (eb) => eb.fn.countAll<number>().as("count")])
		.where("role_id", "is not", null)
		.groupBy("role_id")
		.execute();
	return new Map(rows.map((row) => [row.role_id ?? "", Number(row.count)]));
}

export async function handleRoleList(
	db: Kysely<Database>,
): Promise<ApiResult<{ items: RoleItem[]; permissions: PermissionCatalogEntry[] }>> {
	try {
		const [rows, counts] = await Promise.all([
			db.selectFrom("_emdash_roles").selectAll().orderBy("label").execute(),
			countUsersByRole(db),
		]);
		return {
			success: true,
			data: {
				items: rows.map((row) => toItem(row, counts.get(row.id) ?? 0)),
				permissions: permissionCatalog(),
			},
		};
	} catch {
		return { success: false, error: { code: "ROLE_LIST_ERROR", message: "Failed to list roles" } };
	}
}

export async function handleRoleGet(
	db: Kysely<Database>,
	id: string,
): Promise<ApiResult<{ item: RoleItem }>> {
	try {
		const row = await db
			.selectFrom("_emdash_roles")
			.selectAll()
			.where("id", "=", id)
			.executeTakeFirst();
		if (!row) return { success: false, error: { code: "NOT_FOUND", message: "Role not found" } };
		const counts = await countUsersByRole(db);
		return { success: true, data: { item: toItem(row, counts.get(row.id) ?? 0) } };
	} catch {
		return { success: false, error: { code: "ROLE_GET_ERROR", message: "Failed to get role" } };
	}
}

export async function handleRoleCreate(
	db: Kysely<Database>,
	input: RoleInput & { slug: string; label: string; description?: string | null },
): Promise<ApiResult<{ item: RoleItem }>> {
	const invalid = validateGrantInput(input);
	if (invalid) return { success: false, error: { code: "VALIDATION_ERROR", message: invalid } };
	try {
		const existing = await db
			.selectFrom("_emdash_roles")
			.select("id")
			.where("slug", "=", input.slug)
			.executeTakeFirst();
		if (existing) {
			return {
				success: false,
				error: { code: "SLUG_CONFLICT", message: `A role with slug "${input.slug}" exists` },
			};
		}
		const now = new Date().toISOString();
		const row: RoleRow = {
			id: ulid(),
			slug: input.slug,
			label: input.label,
			description: input.description ?? null,
			grants: JSON.stringify(normalizeGrants(input)),
			created_at: now,
			updated_at: now,
		};
		await db.insertInto("_emdash_roles").values(row).execute();
		return { success: true, data: { item: toItem(row, 0) } };
	} catch {
		return {
			success: false,
			error: { code: "ROLE_CREATE_ERROR", message: "Failed to create role" },
		};
	}
}

/**
 * Updates the role and the compatibility level of every user, invite and
 * signup domain that references it, in one transaction or, where the
 * backend has none, one atomic batch.
 */
export async function handleRoleUpdate(
	db: Kysely<Database>,
	id: string,
	input: RoleInput & { label?: string; description?: string | null },
): Promise<ApiResult<{ item: RoleItem }>> {
	const invalid = validateGrantInput(input);
	if (invalid) return { success: false, error: { code: "VALIDATION_ERROR", message: invalid } };
	try {
		const updated = await withTransaction(db, async (trx) => {
			let select = trx.selectFrom("_emdash_roles").selectAll().where("id", "=", id);
			// Serializes with an assignment that reads the level inside its own write.
			if (isPostgres(trx)) select = select.forUpdate();
			const row = await select.executeTakeFirst();
			if (!row) return null;
			const current = parseGrants(row.grants);
			const grants: RoleGrants = normalizeGrants({
				permissions: input.permissions ?? current.permissions,
				collections: input.collections ?? current.collections,
			});
			const level = compatibilityLevel(grants);
			const next: RoleRow = {
				...row,
				label: input.label ?? row.label,
				description: input.description === undefined ? row.description : input.description,
				grants: JSON.stringify(grants),
				updated_at: new Date().toISOString(),
			};
			const writes = [
				trx
					.updateTable("_emdash_roles")
					.set({
						label: next.label,
						description: next.description,
						grants: next.grants,
						updated_at: next.updated_at,
					})
					.where("id", "=", id),
				trx.updateTable("users").set({ role: level }).where("role_id", "=", id),
				trx.updateTable("auth_tokens").set({ role: level }).where("role_id", "=", id),
				trx
					.updateTable("allowed_domains")
					.set({ default_role: level })
					.where("default_role_id", "=", id),
			];
			const batched = await executeAtomicBatchIfSupported(trx, writes);
			if (!batched) {
				for (const write of writes) {
					// oxlint-disable-next-line no-await-in-loop -- the role row first, then the rows that mirror its level
					await write.execute();
				}
			}
			return next;
		});
		if (!updated)
			return { success: false, error: { code: "NOT_FOUND", message: "Role not found" } };
		const counts = await countUsersByRole(db);
		return { success: true, data: { item: toItem(updated, counts.get(id) ?? 0) } };
	} catch {
		return {
			success: false,
			error: { code: "ROLE_UPDATE_ERROR", message: "Failed to update role" },
		};
	}
}

/** A role that a user, invite or signup domain references cannot be deleted. */
export async function handleRoleDelete(
	db: Kysely<Database>,
	id: string,
): Promise<ApiResult<{ deleted: true }>> {
	try {
		return await withTransaction(db, async (trx): Promise<ApiResult<{ deleted: true }>> => {
			const row = await trx
				.selectFrom("_emdash_roles")
				.select("id")
				.where("id", "=", id)
				.executeTakeFirst();
			if (!row) return { success: false, error: { code: "NOT_FOUND", message: "Role not found" } };
			const now = new Date().toISOString();
			const [user, invite, domain] = await Promise.all([
				trx.selectFrom("users").select("id").where("role_id", "=", id).executeTakeFirst(),
				trx
					.selectFrom("auth_tokens")
					.select("hash")
					.where("role_id", "=", id)
					.where("expires_at", ">", now)
					.executeTakeFirst(),
				trx
					.selectFrom("allowed_domains")
					.select("domain")
					.where("default_role_id", "=", id)
					.executeTakeFirst(),
			]);
			if (user || invite || domain) {
				return {
					success: false,
					error: {
						code: "ROLE_IN_USE",
						message: "The role is assigned to a user, an invite or a signup domain",
					},
				};
			}
			// Expired invites still point at the role and would stop the foreign key.
			await trx
				.deleteFrom("auth_tokens")
				.where("role_id", "=", id)
				.where("expires_at", "<=", now)
				.execute();
			await trx.deleteFrom("_emdash_roles").where("id", "=", id).execute();
			return { success: true, data: { deleted: true } };
		});
	} catch {
		return {
			success: false,
			error: { code: "ROLE_DELETE_ERROR", message: "Failed to delete role" },
		};
	}
}

/**
 * Load a role by id for assignment. Inside the transaction that writes the
 * assignment, `forUpdate` holds the row against a concurrent role edit so
 * the level written is the one the grants are worth at commit.
 */
export async function findRoleForAssignment(
	db: Kysely<Database>,
	id: string,
	options: { forUpdate?: boolean } = {},
): Promise<{ id: string; level: RoleLevel } | null> {
	let select = db.selectFrom("_emdash_roles").select(["id", "grants"]).where("id", "=", id);
	if (options.forUpdate && isPostgres(db)) select = select.forUpdate();
	const row = await select.executeTakeFirst();
	if (!row) return null;
	return { id: row.id, level: compatibilityLevel(parseGrants(row.grants)) };
}
