import { Button, Checkbox, Dialog, Input, InputArea } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import { X } from "@phosphor-icons/react";
import * as React from "react";

import type { CustomRoleItem, PermissionCatalogEntry, RoleInput } from "../../lib/api/roles.js";
import { cn } from "../../lib/utils.js";
import { DialogError, getMutationError } from "../DialogError.js";
import { RoleBadge } from "../users/RoleBadge.js";
import {
	ANY_INCLUDES_OWN,
	CONTENT_PERMISSION_COLUMNS,
	actionLabel,
	areaLabel,
	permissionArea,
} from "./permissionLabels.js";

/** Scope key for permissions that apply in every collection. */
const ALL = "*";

const LEVELS_HIGH_TO_LOW = [50, 40, 30, 20] as const;

export interface RoleEditorDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The role being edited; omitted when creating one. */
	role?: CustomRoleItem | null;
	/** Site-wide permissions a new role starts with, e.g. a built-in role's. */
	template?: readonly string[];
	catalog: readonly PermissionCatalogEntry[];
	collections: ReadonlyArray<{ slug: string; label: string }>;
	isSaving: boolean;
	error: unknown;
	onSave: (input: RoleInput & { slug: string }) => void;
}

interface Draft {
	label: string;
	slug: string;
	description: string;
	/** Scope (`*` or a collection slug) to the permissions granted there. */
	grants: Record<string, Set<string>>;
}

function draftFrom(
	role: CustomRoleItem | null | undefined,
	template: readonly string[] | undefined,
): Draft {
	const grants: Record<string, Set<string>> = { [ALL]: new Set(role?.permissions ?? template) };
	for (const [collection, names] of Object.entries(role?.collections ?? {})) {
		grants[collection] = new Set(names);
	}
	return {
		label: role?.label ?? "",
		slug: role?.slug ?? "",
		description: role?.description ?? "",
		grants,
	};
}

const NON_SLUG_CHARS = /[^a-z0-9]+/g;
const LEADING_NON_LETTERS = /^[^a-z]+/;
const TRAILING_DASHES = /-+$/;

function slugFromLabel(label: string): string {
	return label
		.toLowerCase()
		.replace(NON_SLUG_CHARS, "-")
		.replace(LEADING_NON_LETTERS, "")
		.replace(TRAILING_DASHES, "")
		.slice(0, 63);
}

/**
 * The built-in level code that compares role numbers sees: the highest
 * built-in role whose permissions the role holds in every collection.
 */
export function compatibilityLevelOf(
	siteWide: ReadonlySet<string>,
	catalog: readonly PermissionCatalogEntry[],
): number {
	const held = new Set(siteWide);
	for (const [any, own] of Object.entries(ANY_INCLUDES_OWN)) {
		if (held.has(any)) held.add(own);
	}
	for (const level of LEVELS_HIGH_TO_LOW) {
		if (catalog.every((entry) => entry.minRole > level || held.has(entry.name))) return level;
	}
	return 10;
}

export function RoleEditorDialog({
	open,
	onOpenChange,
	role,
	template,
	catalog,
	collections,
	isSaving,
	error,
	onSave,
}: RoleEditorDialogProps) {
	const { t } = useLingui();
	const [draft, setDraft] = React.useState(() => draftFrom(role, template));
	const [slugEdited, setSlugEdited] = React.useState(false);
	const isEdit = Boolean(role);

	React.useEffect(() => {
		if (open) {
			setDraft(draftFrom(role, template));
			setSlugEdited(false);
		}
	}, [open, role, template]);

	const siteWideEntries = catalog.filter((entry) => !entry.collectionScoped);
	const areas = React.useMemo(() => {
		const byArea = new Map<string, PermissionCatalogEntry[]>();
		for (const entry of siteWideEntries) {
			const area = permissionArea(entry.name);
			byArea.set(area, [...(byArea.get(area) ?? []), entry]);
		}
		return [...byArea.entries()];
	}, [siteWideEntries]);

	const holds = (scope: string, name: string) => draft.grants[scope]?.has(name) ?? false;
	/** Granted through a site-wide grant or through the matching `_any` grant. */
	const impliedBy = (scope: string, name: string): string | null => {
		if (scope !== ALL && holds(ALL, name)) return t`Granted for all collections`;
		const any = Object.entries(ANY_INCLUDES_OWN).find(([, own]) => own === name)?.[0];
		if (any && (holds(scope, any) || (scope !== ALL && holds(ALL, any)))) {
			return t`Included in ${actionText(any)}`;
		}
		return null;
	};
	const actionText = (name: string) => {
		const label = actionLabel(name);
		return typeof label === "string" ? label : t(label);
	};
	const areaText = (area: string) => {
		const label = areaLabel(area);
		return typeof label === "string" ? label : t(label);
	};

	const toggle = (scope: string, name: string, checked: boolean) => {
		setDraft((current) => {
			const next = new Set(current.grants[scope]);
			if (checked) next.add(name);
			else next.delete(name);
			return { ...current, grants: { ...current.grants, [scope]: next } };
		});
	};

	const level = compatibilityLevelOf(draft.grants[ALL] ?? new Set(), catalog);
	const scopedCount = Object.entries(draft.grants).filter(
		([scope, names]) => scope !== ALL && names.size > 0,
	).length;

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		const collectionsGrant: Record<string, string[]> = {};
		for (const [scope, names] of Object.entries(draft.grants)) {
			if (scope === ALL || names.size === 0) continue;
			collectionsGrant[scope] = [...names];
		}
		onSave({
			slug: draft.slug,
			label: draft.label.trim(),
			description: draft.description.trim() || null,
			permissions: [...(draft.grants[ALL] ?? [])],
			collections: collectionsGrant,
		});
	};

	const rows: Array<{ scope: string; label: string; hint?: string }> = [
		{ scope: ALL, label: t`All collections`, hint: t`Also covers collections added later` },
		...collections.map((collection) => ({
			scope: collection.slug,
			label: collection.label,
			hint: collection.slug,
		})),
	];

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog
				className="max-h-[90vh] w-[min(72rem,calc(100vw-2rem))] overflow-y-auto p-6"
				size="xl"
			>
				<form onSubmit={submit}>
					<div className="mb-4 flex items-start justify-between gap-4">
						<Dialog.Title className="text-lg font-semibold leading-none tracking-tight">
							{isEdit ? t`Edit role` : t`New role`}
						</Dialog.Title>
						<Dialog.Close
							aria-label={t`Close`}
							render={(props) => (
								<Button {...props} variant="ghost" shape="square" aria-label={t`Close`}>
									<X className="h-4 w-4" aria-hidden="true" />
								</Button>
							)}
						/>
					</div>

					<div className="space-y-6">
						<div className="grid gap-4 sm:grid-cols-2">
							<Input
								label={t`Name`}
								value={draft.label}
								required
								onChange={(event) => {
									const label = event.target.value;
									setDraft((current) => ({
										...current,
										label,
										slug: isEdit || slugEdited ? current.slug : slugFromLabel(label),
									}));
								}}
								placeholder={t`Jobs editor`}
							/>
							<Input
								label={t`Slug`}
								value={draft.slug}
								required
								disabled={isEdit}
								description={
									isEdit
										? t`Seed files and identity providers refer to the role by its slug.`
										: undefined
								}
								onChange={(event) => {
									setSlugEdited(true);
									setDraft((current) => ({ ...current, slug: event.target.value }));
								}}
								placeholder="jobs-editor"
							/>
						</div>
						<InputArea
							label={t`Description`}
							value={draft.description}
							rows={2}
							onChange={(event) =>
								setDraft((current) => ({ ...current, description: event.target.value }))
							}
						/>

						<section aria-labelledby="role-collections-heading">
							<h3 id="role-collections-heading" className="font-semibold">
								{t`Content`}
							</h3>
							<p className="mt-1 text-sm text-kumo-subtle">
								{t`Choose what the role may do in each collection. A collection the role holds nothing in is hidden from it and refused by the API.`}
							</p>
							<div className="mt-3 overflow-x-auto rounded-md border border-kumo-line">
								<table className="w-full text-sm">
									<thead>
										<tr className="border-b border-kumo-line bg-kumo-tint/40">
											<th scope="col" className="min-w-48 px-3 py-2 text-start font-medium">
												{t`Collection`}
											</th>
											{CONTENT_PERMISSION_COLUMNS.map((name) => (
												<th
													key={name}
													scope="col"
													className="px-2 py-2 text-center text-xs font-medium whitespace-nowrap"
												>
													{actionText(name)}
												</th>
											))}
										</tr>
									</thead>
									<tbody>
										{rows.map((row) => (
											<tr
												key={row.scope}
												className={cn(
													"border-b border-kumo-line last:border-b-0",
													row.scope === ALL && "bg-kumo-tint/20",
												)}
											>
												<th scope="row" className="px-3 py-2 text-start font-normal">
													<span className="block font-medium">{row.label}</span>
													{row.hint && (
														<span className="block text-xs text-kumo-subtle">{row.hint}</span>
													)}
												</th>
												{CONTENT_PERMISSION_COLUMNS.map((name) => {
													const implied = impliedBy(row.scope, name);
													return (
														<td key={name} className="px-2 py-2 text-center">
															<span className="inline-flex" title={implied ?? undefined}>
																<Checkbox
																	checked={holds(row.scope, name) || implied !== null}
																	disabled={implied !== null}
																	onCheckedChange={(checked) =>
																		toggle(row.scope, name, checked === true)
																	}
																	aria-label={t`${actionText(name)}: ${row.label}`}
																/>
															</span>
														</td>
													);
												})}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</section>

						<section aria-labelledby="role-site-heading">
							<h3 id="role-site-heading" className="font-semibold">
								{t`Everything else`}
							</h3>
							<p className="mt-1 text-sm text-kumo-subtle">
								{t`These permissions apply to the whole site.`}
							</p>
							<div className="mt-3 divide-y divide-kumo-line rounded-md border border-kumo-line">
								{areas.map(([area, entries]) => (
									<div
										key={area}
										role="group"
										aria-label={areaText(area)}
										className="flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-2"
									>
										<span className="w-36 shrink-0 text-sm font-medium">{areaText(area)}</span>
										{entries.map((entry) => {
											const implied = impliedBy(ALL, entry.name);
											return (
												<span
													key={entry.name}
													title={
														entry.builtInAdminOnly
															? t`Only the built-in Admin role can hold this`
															: (implied ?? undefined)
													}
												>
													<Checkbox
														label={actionText(entry.name)}
														checked={holds(ALL, entry.name) || implied !== null}
														disabled={entry.builtInAdminOnly || implied !== null}
														onCheckedChange={(checked) => toggle(ALL, entry.name, checked === true)}
													/>
												</span>
											);
										})}
									</div>
								))}
							</div>
						</section>

						<div className="flex flex-wrap items-center gap-2 rounded-md bg-kumo-tint/40 px-3 py-2 text-sm">
							<span>{t`Plugins and code that compare role levels see this role as`}</span>
							<RoleBadge role={level} />
							{scopedCount > 0 && level === 10 && (
								<span className="text-kumo-subtle">
									{t`(the lowest level; the role's collection permissions don't count toward it)`}
								</span>
							)}
						</div>

						<DialogError message={getMutationError(error)} />

						<div className="flex justify-end gap-2">
							<Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
								{t`Cancel`}
							</Button>
							<Button
								type="submit"
								loading={isSaving}
								disabled={!draft.label.trim() || !draft.slug}
							>
								{isEdit ? t`Save role` : t`Create role`}
							</Button>
						</div>
					</div>
				</form>
			</Dialog>
		</Dialog.Root>
	);
}
