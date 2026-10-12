/**
 * Creates the demo personas in ./data.db and prints a sign-in link for each.
 *
 * Run after the site has been set up once (the dev bypass applies the seed,
 * which creates the custom roles). Re-running is safe: existing personas are
 * updated to their role.
 */

import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { compatibilityLevel, normalizeGrants } from "@emdash-cms/auth/rbac";

const PERSONAS = [
	{ email: "sam@demo.local", name: "Sam (Jobs editor)", role: "jobs-editor" },
	{ email: "pat@demo.local", name: "Pat (Jobs writer)", role: "jobs-writer" },
	{ email: "robin@demo.local", name: "Robin (Byline editor)", role: "byline-editor" },
	{ email: "kim@demo.local", name: "Kim (Site editor)", role: "site-editor" },
	{ email: "alex@demo.local", name: "Alex (built-in Editor)", level: 40 },
	{ email: "chris@demo.local", name: "Chris (built-in Contributor)", level: 20 },
];

const db = new DatabaseSync(new URL("../data.db", import.meta.url).pathname);
const origin = process.env.DEMO_ORIGIN ?? "http://localhost:4325";
const now = new Date().toISOString();

const findRole = db.prepare("SELECT id, grants FROM _emdash_roles WHERE slug = ?");
const findUser = db.prepare("SELECT id FROM users WHERE email = ?");
const insertUser = db.prepare(
	`INSERT INTO users (id, email, name, role, role_id, email_verified, disabled, data, created_at, updated_at)
	 VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
);
const updateUser = db.prepare(
	"UPDATE users SET name = ?, role = ?, role_id = ?, updated_at = ? WHERE id = ?",
);

for (const persona of PERSONAS) {
	let level = persona.level;
	let roleId = null;
	if (persona.role) {
		const role = findRole.get(persona.role);
		if (!role) {
			console.error(`Role "${persona.role}" not found. Set up the site first (see README).`);
			process.exit(1);
		}
		roleId = role.id;
		level = compatibilityLevel(normalizeGrants(JSON.parse(role.grants)));
	}
	const existing = findUser.get(persona.email);
	if (existing) {
		updateUser.run(persona.name, level, roleId, now, existing.id);
	} else {
		insertUser.run(
			randomUUID(),
			persona.email,
			persona.name,
			level,
			roleId,
			JSON.stringify({ welcomeDismissed: true }),
			now,
			now,
		);
	}
	const link = `${origin}/_emdash/api/auth/dev-bypass?as=${encodeURIComponent(persona.email)}&redirect=/_emdash/admin`;
	console.log(`${persona.name.padEnd(30)} stored level ${String(level).padEnd(3)} ${link}`);
}
