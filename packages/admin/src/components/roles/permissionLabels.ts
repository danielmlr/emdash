import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/** Content permissions in the order the collection matrix shows them. */
export const CONTENT_PERMISSION_COLUMNS = [
	"content:read",
	"content:read_drafts",
	"content:create",
	"content:edit_own",
	"content:edit_any",
	"content:publish_own",
	"content:publish_any",
	"content:delete_own",
	"content:delete_any",
	"content:delete_permanent",
] as const;

/**
 * Permissions and the permission each one includes: `_any` includes `_own`,
 * and managing an area includes reading it. Mirrors the server's rule.
 */
export const ANY_INCLUDES_OWN: Readonly<Record<string, string>> = {
	"content:edit_any": "content:edit_own",
	"content:delete_any": "content:delete_own",
	"content:publish_any": "content:publish_own",
	"media:edit_any": "media:edit_own",
	"media:delete_any": "media:delete_own",
	"taxonomies:manage": "taxonomies:read",
	"comments:moderate": "comments:read",
	"menus:manage": "menus:read",
	"bylines:manage": "bylines:read",
	"widgets:manage": "widgets:read",
	"sections:manage": "sections:read",
	"redirects:manage": "redirects:read",
	"search:manage": "search:read",
};

const AREA_LABELS: Record<string, MessageDescriptor> = {
	content: msg`Content`,
	media: msg`Media`,
	taxonomies: msg`Taxonomies`,
	comments: msg`Comments`,
	menus: msg`Menus`,
	bylines: msg`Bylines`,
	widgets: msg`Widgets`,
	sections: msg`Sections`,
	redirects: msg`Redirects`,
	users: msg`Users`,
	settings: msg`Settings`,
	schema: msg`Content types`,
	plugins: msg`Plugins`,
	import: msg`Import`,
	backups: msg`Backups`,
	transfer: msg`Site transfer`,
	updates: msg`Core updates`,
	search: msg`Search`,
	auth: msg`Account`,
};

const ACTION_LABELS: Record<string, MessageDescriptor> = {
	read: msg`Read`,
	read_drafts: msg`Read drafts`,
	create: msg`Create`,
	edit_own: msg`Edit own`,
	edit_any: msg`Edit any`,
	delete_own: msg`Delete own`,
	delete_any: msg`Delete any`,
	delete_permanent: msg`Delete permanently`,
	publish_own: msg`Publish own`,
	publish_any: msg`Publish any`,
	upload: msg`Upload`,
	manage: msg`Manage`,
	moderate: msg`Moderate`,
	delete: msg`Delete`,
	settings: msg`Settings`,
	invite: msg`Invite`,
	execute: msg`Run`,
	export: msg`Export`,
	import: msg`Import`,
	manage_own_credentials: msg`Own passkeys`,
	manage_connections: msg`Sign-in connections`,
};

export function permissionArea(name: string): string {
	return name.split(":")[0] ?? name;
}

export function areaLabel(area: string): MessageDescriptor | string {
	return AREA_LABELS[area] ?? area;
}

export function actionLabel(name: string): MessageDescriptor | string {
	const action = name.split(":")[1] ?? name;
	return ACTION_LABELS[action] ?? action;
}
