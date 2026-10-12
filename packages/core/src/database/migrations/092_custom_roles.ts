import type { Kysely } from "kysely";

import { columnExists } from "../dialect-helpers.js";

/**
 * Custom roles: named permission sets that users, invites and signup domains
 * can reference. A NULL reference means the built-in level in the existing
 * role column, which is what every existing row keeps.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("_emdash_roles")
		.ifNotExists()
		.addColumn("id", "text", (col) => col.primaryKey())
		.addColumn("slug", "text", (col) => col.notNull().unique())
		.addColumn("label", "text", (col) => col.notNull())
		.addColumn("description", "text")
		.addColumn("grants", "text", (col) => col.notNull())
		.addColumn("created_at", "text", (col) => col.notNull())
		.addColumn("updated_at", "text", (col) => col.notNull())
		.execute();

	const references: Array<[table: string, column: string, index: string]> = [
		["users", "role_id", "idx_users_role_id"],
		["auth_tokens", "role_id", "idx_auth_tokens_role_id"],
		["allowed_domains", "default_role_id", "idx_allowed_domains_default_role_id"],
	];
	for (const [table, column, index] of references) {
		if (!(await columnExists(db, table, column))) {
			await db.schema
				.alterTable(table)
				.addColumn(column, "text", (col) => col.references("_emdash_roles.id"))
				.execute();
		}
		await db.schema.createIndex(index).ifNotExists().on(table).column(column).execute();
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	const references: Array<[table: string, column: string, index: string]> = [
		["users", "role_id", "idx_users_role_id"],
		["auth_tokens", "role_id", "idx_auth_tokens_role_id"],
		["allowed_domains", "default_role_id", "idx_allowed_domains_default_role_id"],
	];
	for (const [table, column, index] of references) {
		await db.schema.dropIndex(index).ifExists().execute();
		if (await columnExists(db, table, column)) {
			await db.schema.alterTable(table).dropColumn(column).execute();
		}
	}
	await db.schema.dropTable("_emdash_roles").ifExists().execute();
}
