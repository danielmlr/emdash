/**
 * Kysely database adapter for @emdash-cms/auth
 */

import type { Kysely, Insertable, Selectable, Updateable } from "kysely";
import { ulid } from "ulidx";

import { normalizeGrants, type CustomRole } from "../rbac.js";
import {
	Role,
	toRoleLevel,
	toDeviceType,
	toTokenType,
	type AuthAdapter,
	type User,
	type NewUser,
	type UpdateUser,
	type Credential,
	type NewCredential,
	type AuthToken,
	type NewAuthToken,
	type TokenType,
	type OAuthAccount,
	type NewOAuthAccount,
	type AllowedDomain,
	type RoleLevel,
} from "../types.js";

// ============================================================================
// Database schema types
// ============================================================================

export interface AuthTables {
	users: UserTable;
	credentials: CredentialTable;
	auth_tokens: AuthTokenTable;
	oauth_accounts: OAuthAccountTable;
	allowed_domains: AllowedDomainTable;
	_emdash_roles: RoleTable;
}

interface UserTable {
	id: string;
	email: string;
	name: string | null;
	avatar_url: string | null;
	role: number;
	role_id: string | null;
	email_verified: number;
	disabled: number;
	data: string | null;
	created_at: string;
	updated_at: string;
}

interface CredentialTable {
	id: string;
	user_id: string;
	public_key: Uint8Array;
	algorithm: number;
	counter: number;
	device_type: string;
	backed_up: number;
	transports: string | null;
	name: string | null;
	created_at: string;
	last_used_at: string;
}

interface AuthTokenTable {
	hash: string;
	user_id: string | null;
	email: string | null;
	type: string;
	role: number | null;
	role_id: string | null;
	invited_by: string | null;
	expires_at: string;
	created_at: string;
}

interface OAuthAccountTable {
	provider: string;
	provider_account_id: string;
	user_id: string;
	created_at: string;
}

interface AllowedDomainTable {
	domain: string;
	default_role: number;
	default_role_id: string | null;
	enabled: number;
	created_at: string;
}

interface RoleTable {
	id: string;
	slug: string;
	label: string;
	description: string | null;
	/** JSON-encoded {@link RoleGrants} */
	grants: string;
	created_at: string;
	updated_at: string;
}

/** Columns selected from `_emdash_roles` alongside a user row. */
interface CustomRoleColumns {
	custom_role_slug: string | null;
	custom_role_label: string | null;
	custom_role_grants: string | null;
}

// ============================================================================
// Adapter implementation
// ============================================================================

type UserRow = Selectable<UserTable> & Partial<CustomRoleColumns>;

/**
 * A build that knows custom roles can serve requests before migration 092
 * has created `_emdash_roles` (migration mode `manual`). The role join then
 * fails on every signed-in request; the plain user select stands in for a
 * minute before the join is tried again, so one failed query per process
 * and minute is all that period costs. No row can reference a role before
 * the table exists, so the plain select answers the same.
 */
const ROLE_JOIN_FAILED_AT = Symbol.for("emdash:auth:role-join-failed-at");
const ROLE_JOIN_RETRY_MS = 60_000;

function roleJoinUnavailable(): boolean {
	const failedAt = (globalThis as Record<symbol, unknown>)[ROLE_JOIN_FAILED_AT];
	return typeof failedAt === "number" && Date.now() - failedAt < ROLE_JOIN_RETRY_MS;
}

function isMissingRolesTable(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("_emdash_roles") &&
		(message.includes("no such table") || message.includes("does not exist"))
	);
}

async function withRoleJoinFallback<T>(
	joined: () => Promise<T>,
	plain: () => Promise<T>,
): Promise<T> {
	if (roleJoinUnavailable()) return plain();
	try {
		return await joined();
	} catch (error) {
		if (!isMissingRolesTable(error)) throw error;
		(globalThis as Record<symbol, unknown>)[ROLE_JOIN_FAILED_AT] = Date.now();
		return plain();
	}
}

export function createKyselyAdapter<T extends AuthTables>(db: Kysely<T>): AuthAdapter {
	// Type cast to work with generic Kysely instance
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- generic Kysely<T extends AuthTables> narrowed to concrete AuthTables for internal queries
	const kdb = db as unknown as Kysely<AuthTables>;

	// The custom role arrives in the same query as the user, so resolving a
	// custom role costs no additional round trip.
	const selectUsersWithCustomRole = () =>
		kdb
			.selectFrom("users")
			.leftJoin("_emdash_roles", "_emdash_roles.id", "users.role_id")
			.selectAll("users")
			.select([
				"_emdash_roles.slug as custom_role_slug",
				"_emdash_roles.label as custom_role_label",
				"_emdash_roles.grants as custom_role_grants",
			]);

	return {
		// ========================================================================
		// Users
		// ========================================================================

		async getUserById(id: string): Promise<User | null> {
			const row = await withRoleJoinFallback<UserRow | undefined>(
				() => selectUsersWithCustomRole().where("users.id", "=", id).executeTakeFirst(),
				() => kdb.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst(),
			);

			return row ? rowToUser(row) : null;
		},

		async getUserByEmail(email: string): Promise<User | null> {
			const normalized = email.toLowerCase();
			const row = await withRoleJoinFallback<UserRow | undefined>(
				() => selectUsersWithCustomRole().where("users.email", "=", normalized).executeTakeFirst(),
				() =>
					kdb.selectFrom("users").selectAll().where("email", "=", normalized).executeTakeFirst(),
			);

			return row ? rowToUser(row) : null;
		},

		async createUser(user: NewUser): Promise<User> {
			const now = new Date().toISOString();
			const id = ulid();

			const row: Insertable<UserTable> = {
				id,
				email: user.email.toLowerCase(),
				name: user.name ?? null,
				avatar_url: user.avatarUrl ?? null,
				role: user.role ?? Role.SUBSCRIBER,
				role_id: user.roleId ?? null,
				email_verified: user.emailVerified ? 1 : 0,
				disabled: 0,
				data: user.data ? JSON.stringify(user.data) : null,
				created_at: now,
				updated_at: now,
			};

			await kdb.insertInto("users").values(row).execute();

			if (row.role_id) {
				const created = await selectUsersWithCustomRole()
					.where("users.id", "=", id)
					.executeTakeFirstOrThrow();
				return rowToUser(created);
			}

			return {
				id,
				email: row.email,
				name: user.name ?? null,
				avatarUrl: user.avatarUrl ?? null,
				role: toRoleLevel(row.role),
				customRole: null,
				emailVerified: row.email_verified === 1,
				disabled: false,
				data: user.data ?? null,
				createdAt: new Date(now),
				updatedAt: new Date(now),
			};
		},

		async updateUser(id: string, data: UpdateUser): Promise<void> {
			const update: Updateable<UserTable> = {
				updated_at: new Date().toISOString(),
			};

			if (data.email !== undefined) update.email = data.email.toLowerCase();
			if (data.name !== undefined) update.name = data.name;
			if (data.avatarUrl !== undefined) update.avatar_url = data.avatarUrl;
			if (data.role !== undefined) update.role = data.role;
			if (data.roleId !== undefined) update.role_id = data.roleId;
			if (data.emailVerified !== undefined) update.email_verified = data.emailVerified ? 1 : 0;
			if (data.disabled !== undefined) update.disabled = data.disabled ? 1 : 0;
			if (data.data !== undefined) update.data = data.data ? JSON.stringify(data.data) : null;

			await kdb.updateTable("users").set(update).where("id", "=", id).execute();
		},

		async deleteUser(id: string): Promise<void> {
			await kdb.deleteFrom("users").where("id", "=", id).execute();
		},

		async countUsers(): Promise<number> {
			const result = await kdb
				.selectFrom("users")
				.select((eb) => eb.fn.countAll<number>().as("count"))
				.executeTakeFirstOrThrow();

			return result.count;
		},

		async getUsers(options?: {
			search?: string;
			role?: number;
			roleId?: string;
			cursor?: string;
			limit?: number;
		}): Promise<{
			items: Array<
				User & {
					lastLogin: Date | null;
					credentialCount: number;
					oauthProviders: string[];
				}
			>;
			nextCursor?: string;
		}> {
			const limit = Math.min(options?.limit ?? 20, 100);

			let query = kdb
				.selectFrom("users")
				.leftJoin("credentials", "users.id", "credentials.user_id")
				.leftJoin("_emdash_roles", "_emdash_roles.id", "users.role_id")
				.selectAll("users")
				.select((eb) => [
					eb.fn.count<number>("credentials.id").as("credential_count"),
					eb.fn.max("credentials.last_used_at").as("last_login"),
					eb.fn.max("_emdash_roles.slug").as("custom_role_slug"),
					eb.fn.max("_emdash_roles.label").as("custom_role_label"),
					eb.fn.max("_emdash_roles.grants").as("custom_role_grants"),
				])
				.groupBy("users.id")
				.orderBy("users.created_at", "desc")
				.limit(limit + 1);

			// Apply filters
			if (options?.search) {
				const searchPattern = `%${options.search}%`;
				query = query.where((eb) =>
					eb.or([
						eb("users.email", "like", searchPattern),
						eb("users.name", "like", searchPattern),
					]),
				);
			}

			if (options?.role !== undefined) {
				query = query.where("users.role", "=", options.role);
			}
			if (options?.roleId !== undefined) {
				query = query.where("users.role_id", "=", options.roleId);
			}

			if (options?.cursor) {
				// Get the cursor user's created_at for pagination
				const cursorUser = await kdb
					.selectFrom("users")
					.select("created_at")
					.where("id", "=", options.cursor)
					.executeTakeFirst();

				if (cursorUser) {
					query = query.where("users.created_at", "<", cursorUser.created_at);
				}
			}

			const rows = await query.execute();

			// Get OAuth providers for all users in this batch
			const userIds = rows.slice(0, limit).map((r) => r.id);
			const oauthAccounts =
				userIds.length > 0
					? await kdb
							.selectFrom("oauth_accounts")
							.select(["user_id", "provider"])
							.where("user_id", "in", userIds)
							.execute()
					: [];

			// Group OAuth providers by user
			const oauthByUser = new Map<string, string[]>();
			for (const account of oauthAccounts) {
				const providers = oauthByUser.get(account.user_id) ?? [];
				providers.push(account.provider);
				oauthByUser.set(account.user_id, providers);
			}

			const hasMore = rows.length > limit;
			const items = rows.slice(0, limit).map((row) => ({
				...rowToUser(row),
				lastLogin: row.last_login ? new Date(row.last_login) : null,
				credentialCount: row.credential_count ?? 0,
				oauthProviders: oauthByUser.get(row.id) ?? [],
			}));

			return {
				items,
				nextCursor: hasMore ? items.at(-1)?.id : undefined,
			};
		},

		async getUserWithDetails(id: string): Promise<{
			user: User;
			credentials: Credential[];
			oauthAccounts: OAuthAccount[];
			lastLogin: Date | null;
		} | null> {
			const user = await withRoleJoinFallback<UserRow | undefined>(
				() => selectUsersWithCustomRole().where("users.id", "=", id).executeTakeFirst(),
				() => kdb.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst(),
			);

			if (!user) return null;

			const [credentials, oauthAccounts] = await Promise.all([
				kdb
					.selectFrom("credentials")
					.selectAll()
					.where("user_id", "=", id)
					.orderBy("created_at", "desc")
					.execute(),
				kdb.selectFrom("oauth_accounts").selectAll().where("user_id", "=", id).execute(),
			]);

			// Find last login from most recent credential use
			const lastLogin = credentials.reduce<Date | null>((latest, cred) => {
				const lastUsed = new Date(cred.last_used_at);
				return !latest || lastUsed > latest ? lastUsed : latest;
			}, null);

			return {
				user: rowToUser(user),
				credentials: credentials.map(rowToCredential),
				oauthAccounts: oauthAccounts.map(rowToOAuthAccount),
				lastLogin,
			};
		},

		async countAdmins(): Promise<number> {
			const result = await kdb
				.selectFrom("users")
				.select((eb) => eb.fn.countAll<number>().as("count"))
				.where("role", "=", Role.ADMIN)
				.where("disabled", "=", 0)
				.executeTakeFirstOrThrow();

			return result.count;
		},

		// ========================================================================
		// Credentials
		// ========================================================================

		async getCredentialById(id: string): Promise<Credential | null> {
			const row = await kdb
				.selectFrom("credentials")
				.selectAll()
				.where("id", "=", id)
				.executeTakeFirst();

			return row ? rowToCredential(row) : null;
		},

		async getCredentialsByUserId(userId: string): Promise<Credential[]> {
			const rows = await kdb
				.selectFrom("credentials")
				.selectAll()
				.where("user_id", "=", userId)
				.execute();

			return rows.map(rowToCredential);
		},

		async createCredential(credential: NewCredential): Promise<Credential> {
			const now = new Date().toISOString();

			const row: Insertable<CredentialTable> = {
				id: credential.id,
				user_id: credential.userId,
				public_key: credential.publicKey,
				algorithm: credential.algorithm,
				counter: credential.counter,
				device_type: credential.deviceType,
				backed_up: credential.backedUp ? 1 : 0,
				transports: credential.transports.length > 0 ? JSON.stringify(credential.transports) : null,
				name: credential.name ?? null,
				created_at: now,
				last_used_at: now,
			};

			await kdb.insertInto("credentials").values(row).execute();

			return {
				id: credential.id,
				userId: credential.userId,
				publicKey: credential.publicKey,
				algorithm: credential.algorithm,
				counter: credential.counter,
				deviceType: credential.deviceType,
				backedUp: credential.backedUp,
				transports: credential.transports,
				name: credential.name ?? null,
				createdAt: new Date(now),
				lastUsedAt: new Date(now),
			};
		},

		async updateCredentialCounter(id: string, counter: number): Promise<void> {
			await kdb
				.updateTable("credentials")
				.set({
					counter,
					last_used_at: new Date().toISOString(),
				})
				.where("id", "=", id)
				.execute();
		},

		async updateCredentialName(id: string, name: string | null): Promise<void> {
			await kdb.updateTable("credentials").set({ name }).where("id", "=", id).execute();
		},

		async deleteCredential(id: string): Promise<void> {
			await kdb.deleteFrom("credentials").where("id", "=", id).execute();
		},

		async countCredentialsByUserId(userId: string): Promise<number> {
			const result = await kdb
				.selectFrom("credentials")
				.select((eb) => eb.fn.countAll<number>().as("count"))
				.where("user_id", "=", userId)
				.executeTakeFirstOrThrow();

			return result.count;
		},

		// ========================================================================
		// Auth Tokens
		// ========================================================================

		async createToken(token: NewAuthToken): Promise<void> {
			const row: Insertable<AuthTokenTable> = {
				hash: token.hash,
				user_id: token.userId ?? null,
				email: token.email ?? null,
				type: token.type,
				role: token.role ?? null,
				role_id: token.roleId ?? null,
				invited_by: token.invitedBy ?? null,
				expires_at: token.expiresAt.toISOString(),
				created_at: new Date().toISOString(),
			};

			await kdb.insertInto("auth_tokens").values(row).execute();
		},

		async getToken(hash: string, type: TokenType): Promise<AuthToken | null> {
			const row = await kdb
				.selectFrom("auth_tokens")
				.selectAll()
				.where("hash", "=", hash)
				.where("type", "=", type)
				.executeTakeFirst();

			return row ? rowToAuthToken(row) : null;
		},

		async consumeToken(hash: string, type: TokenType): Promise<AuthToken | null> {
			const row = await kdb
				.deleteFrom("auth_tokens")
				.where("hash", "=", hash)
				.where("type", "=", type)
				.returningAll()
				.executeTakeFirst();

			return row ? rowToAuthToken(row) : null;
		},

		async deleteToken(hash: string): Promise<void> {
			await kdb.deleteFrom("auth_tokens").where("hash", "=", hash).execute();
		},

		async deleteExpiredTokens(): Promise<void> {
			await kdb
				.deleteFrom("auth_tokens")
				.where("expires_at", "<", new Date().toISOString())
				.execute();
		},

		// ========================================================================
		// OAuth Accounts
		// ========================================================================

		async getOAuthAccount(
			provider: string,
			providerAccountId: string,
		): Promise<OAuthAccount | null> {
			const row = await kdb
				.selectFrom("oauth_accounts")
				.selectAll()
				.where("provider", "=", provider)
				.where("provider_account_id", "=", providerAccountId)
				.executeTakeFirst();

			return row ? rowToOAuthAccount(row) : null;
		},

		async getOAuthAccountsByUserId(userId: string): Promise<OAuthAccount[]> {
			const rows = await kdb
				.selectFrom("oauth_accounts")
				.selectAll()
				.where("user_id", "=", userId)
				.execute();

			return rows.map(rowToOAuthAccount);
		},

		async createOAuthAccount(account: NewOAuthAccount): Promise<OAuthAccount> {
			const now = new Date().toISOString();

			const row: Insertable<OAuthAccountTable> = {
				provider: account.provider,
				provider_account_id: account.providerAccountId,
				user_id: account.userId,
				created_at: now,
			};

			await kdb.insertInto("oauth_accounts").values(row).execute();

			return {
				provider: account.provider,
				providerAccountId: account.providerAccountId,
				userId: account.userId,
				createdAt: new Date(now),
			};
		},

		async deleteOAuthAccount(provider: string, providerAccountId: string): Promise<void> {
			await kdb
				.deleteFrom("oauth_accounts")
				.where("provider", "=", provider)
				.where("provider_account_id", "=", providerAccountId)
				.execute();
		},

		// ========================================================================
		// Allowed Domains
		// ========================================================================

		async getAllowedDomain(domain: string): Promise<AllowedDomain | null> {
			const row = await kdb
				.selectFrom("allowed_domains")
				.selectAll()
				.where("domain", "=", domain.toLowerCase())
				.executeTakeFirst();

			return row ? rowToAllowedDomain(row) : null;
		},

		async getAllowedDomains(): Promise<AllowedDomain[]> {
			const rows = await kdb.selectFrom("allowed_domains").selectAll().execute();

			return rows.map(rowToAllowedDomain);
		},

		async createAllowedDomain(domain: string, defaultRole: RoleLevel): Promise<AllowedDomain> {
			const now = new Date().toISOString();

			const row: Insertable<AllowedDomainTable> = {
				domain: domain.toLowerCase(),
				default_role: defaultRole,
				enabled: 1,
				created_at: now,
			};

			await kdb.insertInto("allowed_domains").values(row).execute();

			return {
				domain: row.domain,
				defaultRole,
				enabled: true,
				createdAt: new Date(now),
			};
		},

		async updateAllowedDomain(
			domain: string,
			enabled: boolean,
			defaultRole?: RoleLevel,
		): Promise<void> {
			const update: Updateable<AllowedDomainTable> = {
				enabled: enabled ? 1 : 0,
			};

			if (defaultRole !== undefined) {
				update.default_role = defaultRole;
			}

			await kdb
				.updateTable("allowed_domains")
				.set(update)
				.where("domain", "=", domain.toLowerCase())
				.execute();
		},

		async deleteAllowedDomain(domain: string): Promise<void> {
			await kdb.deleteFrom("allowed_domains").where("domain", "=", domain.toLowerCase()).execute();
		},
	};
}

// ============================================================================
// Row converters
// ============================================================================

function rowToUser(row: Selectable<UserTable> & Partial<CustomRoleColumns>): User {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		avatarUrl: row.avatar_url,
		role: toRoleLevel(row.role),
		customRole: rowToCustomRole(row),
		emailVerified: row.email_verified === 1,
		disabled: row.disabled === 1,
		data: row.data ? JSON.parse(row.data) : null,
		createdAt: new Date(row.created_at),
		updatedAt: new Date(row.updated_at),
	};
}

/**
 * A user whose role reference points at no role row gets a custom role with
 * no grants, never the built-in level stored beside it.
 */
function rowToCustomRole(
	row: Pick<UserTable, "role_id"> & Partial<CustomRoleColumns>,
): CustomRole | null {
	if (!row.role_id) return null;
	return {
		id: row.role_id,
		slug: row.custom_role_slug ?? "",
		label: row.custom_role_label ?? "",
		grants: parseGrants(row.custom_role_grants ?? null),
	};
}

export function parseGrants(json: string | null): CustomRole["grants"] {
	if (!json) return { permissions: [], collections: {} };
	try {
		const parsed: unknown = JSON.parse(json);
		if (!parsed || typeof parsed !== "object") return { permissions: [], collections: {} };
		const { permissions, collections } = parsed as {
			permissions?: unknown;
			collections?: unknown;
		};
		return normalizeGrants({
			permissions: Array.isArray(permissions)
				? permissions.filter((p): p is string => typeof p === "string")
				: [],
			collections:
				collections && typeof collections === "object"
					? Object.fromEntries(
							Object.entries(collections).map(([slug, names]) => [
								slug,
								Array.isArray(names) ? names.filter((p): p is string => typeof p === "string") : [],
							]),
						)
					: {},
		});
	} catch {
		return { permissions: [], collections: {} };
	}
}

function rowToCredential(row: Selectable<CredentialTable>): Credential {
	return {
		id: row.id,
		userId: row.user_id,
		publicKey: row.public_key,
		algorithm: row.algorithm,
		counter: row.counter,
		deviceType: toDeviceType(row.device_type),
		backedUp: row.backed_up === 1,
		transports: row.transports ? JSON.parse(row.transports) : [],
		name: row.name,
		createdAt: new Date(row.created_at),
		lastUsedAt: new Date(row.last_used_at),
	};
}

function rowToAuthToken(row: Selectable<AuthTokenTable>): AuthToken {
	return {
		hash: row.hash,
		userId: row.user_id,
		email: row.email,
		type: toTokenType(row.type),
		role: row.role != null ? toRoleLevel(row.role) : null,
		roleId: row.role_id ?? null,
		invitedBy: row.invited_by,
		expiresAt: new Date(row.expires_at),
		createdAt: new Date(row.created_at),
	};
}

function rowToOAuthAccount(row: Selectable<OAuthAccountTable>): OAuthAccount {
	return {
		provider: row.provider,
		providerAccountId: row.provider_account_id,
		userId: row.user_id,
		createdAt: new Date(row.created_at),
	};
}

function rowToAllowedDomain(row: Selectable<AllowedDomainTable>): AllowedDomain {
	return {
		domain: row.domain,
		defaultRole: toRoleLevel(row.default_role),
		defaultRoleId: row.default_role_id ?? null,
		enabled: row.enabled === 1,
		createdAt: new Date(row.created_at),
	};
}

// ============================================================================
// Migration SQL
// ============================================================================

export const AUTH_TABLES_SQL = `
-- Users (no password_hash)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  role INTEGER NOT NULL DEFAULT 10,
  role_id TEXT REFERENCES _emdash_roles(id),
  email_verified INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  data TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Passkey credentials
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  algorithm INTEGER NOT NULL DEFAULT -7,
  counter INTEGER NOT NULL DEFAULT 0,
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  name TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);

-- Auth tokens (magic links, email verification, invites)
CREATE TABLE IF NOT EXISTS auth_tokens (
  hash TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  type TEXT NOT NULL,
  role INTEGER,
  role_id TEXT REFERENCES _emdash_roles(id),
  invited_by TEXT REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_email ON auth_tokens(email);

-- OAuth accounts (external provider links)
CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);

-- Allowed domains for self-signup
CREATE TABLE IF NOT EXISTS allowed_domains (
  domain TEXT PRIMARY KEY,
  default_role INTEGER NOT NULL DEFAULT 20,
  default_role_id TEXT REFERENCES _emdash_roles(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Custom roles
CREATE TABLE IF NOT EXISTS _emdash_roles (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  grants TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_role_id ON auth_tokens(role_id);
CREATE INDEX IF NOT EXISTS idx_allowed_domains_default_role_id ON allowed_domains(default_role_id);
`;
