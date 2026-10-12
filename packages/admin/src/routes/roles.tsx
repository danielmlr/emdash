/**
 * Roles page: the built-in roles and the site's custom roles.
 */

import { Badge, Button, Table } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import { CopySimple, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { CONTENT_PERMISSION_COLUMNS, actionLabel } from "../components/roles/permissionLabels.js";
import { RoleEditorDialog } from "../components/roles/RoleEditorDialog.js";
import { RoleBadge } from "../components/users/RoleBadge.js";
import { ROLE_ENTRIES } from "../components/users/roleDefinitions.js";
import { fetchManifest } from "../lib/api";
import {
	createRole,
	deleteRole,
	updateRole,
	useRoles,
	type CustomRoleItem,
	type RoleInput,
} from "../lib/api/roles.js";
import { useCan } from "../lib/permissions";

type EditorState =
	| { mode: "closed" }
	| { mode: "create"; template?: readonly string[] }
	| { mode: "edit"; role: CustomRoleItem };

function otherCount(role: CustomRoleItem): number {
	return role.permissions.filter((name) => !name.startsWith("content:")).length;
}

export function RolesPage() {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const { can } = useCan();
	const allowed = can("users:manage");
	const rolesQuery = useRoles(allowed);
	const { data: manifest } = useQuery({ queryKey: ["manifest"], queryFn: fetchManifest });
	const [editor, setEditor] = React.useState<EditorState>({ mode: "closed" });
	const [pendingDelete, setPendingDelete] = React.useState<CustomRoleItem | null>(null);

	const catalog = rolesQuery.data?.permissions ?? [];
	const collections = React.useMemo(
		() =>
			Object.entries(manifest?.collections ?? {}).map(([slug, config]) => ({
				slug,
				label: config.label,
			})),
		[manifest?.collections],
	);
	const collectionLabel = (slug: string) => manifest?.collections[slug]?.label ?? slug;

	const saveMutation = useMutation({
		mutationFn: (input: RoleInput & { slug: string }) =>
			editor.mode === "edit" ? updateRole(editor.role.id, input) : createRole(input),
		onSuccess: async () => {
			setEditor({ mode: "closed" });
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["roles"] }),
				queryClient.invalidateQueries({ queryKey: ["users"] }),
			]);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (role: CustomRoleItem) => deleteRole(role.id),
		onSuccess: async () => {
			setPendingDelete(null);
			await queryClient.invalidateQueries({ queryKey: ["roles"] });
		},
	});

	if (!allowed) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<div className="text-center">
					<h1 className="text-2xl font-semibold leading-tight">{t`Access Denied`}</h1>
					<p className="mt-2 text-sm text-kumo-subtle">{t`Only administrators can manage roles.`}</p>
				</div>
			</div>
		);
	}

	const builtInTemplate = (level: number) =>
		catalog
			.filter((entry) => entry.minRole <= level && !entry.builtInAdminOnly)
			.map((entry) => entry.name);

	const actionText = (name: string) => {
		const label = actionLabel(name);
		return typeof label === "string" ? label : t(label);
	};

	/** One line per scope, e.g. "Jobs: Read, Create, Edit any". */
	const contentSummary = (role: CustomRoleItem): string[] => {
		const lines: string[] = [];
		const siteWide = CONTENT_PERMISSION_COLUMNS.filter((name) => role.permissions.includes(name));
		if (siteWide.length > 0) {
			lines.push(t`All collections: ${siteWide.map(actionText).join(", ")}`);
		}
		for (const [slug, names] of Object.entries(role.collections)) {
			const visible = CONTENT_PERMISSION_COLUMNS.filter((name) => names.includes(name));
			lines.push(`${collectionLabel(slug)}: ${visible.map(actionText).join(", ")}`);
		}
		return lines;
	};

	return (
		<div className="space-y-8">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold leading-tight">{t`Roles`}</h1>
					<p className="mt-1 max-w-2xl text-sm text-kumo-subtle">
						{t`A role is a set of permissions. The built-in roles are fixed. A custom role holds the permissions you choose, and its content permissions can be limited to chosen collections.`}
					</p>
				</div>
				<Button icon={<Plus />} onClick={() => setEditor({ mode: "create" })}>
					{t`New role`}
				</Button>
			</div>

			<section aria-labelledby="custom-roles-heading" className="space-y-3">
				<h2 id="custom-roles-heading" className="text-lg font-semibold">
					{t`Custom roles`}
				</h2>
				{rolesQuery.data && rolesQuery.data.items.length === 0 ? (
					<p className="rounded-md border border-dashed border-kumo-line p-6 text-sm text-kumo-subtle">
						{t`No custom roles yet. Start from a built-in role below or create one from scratch.`}
					</p>
				) : (
					<div className="overflow-x-auto rounded-md border border-kumo-line">
						<Table>
							<Table.Header>
								<Table.Row>
									<Table.Head>{t`Role`}</Table.Head>
									<Table.Head>{t`Content`}</Table.Head>
									<Table.Head>{t`Seen by level checks as`}</Table.Head>
									<Table.Head className="w-20">{t`Users`}</Table.Head>
									<Table.Head className="w-24">
										<span className="sr-only">{t`Actions`}</span>
									</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{(rolesQuery.data?.items ?? []).map((role) => (
									<Table.Row key={role.id}>
										<Table.Cell>
											<span className="block font-medium">{role.label}</span>
											<bdi dir="ltr" className="block text-xs text-kumo-subtle">
												{role.slug}
											</bdi>
											{role.description && (
												<span className="mt-1 block text-xs text-kumo-subtle">
													{role.description}
												</span>
											)}
										</Table.Cell>
										<Table.Cell className="text-sm">
											{contentSummary(role).map((line) => (
												<span key={line} className="block">
													{line}
												</span>
											))}
											{otherCount(role) > 0 && (
												<span className="mt-1 block text-xs text-kumo-subtle">
													{t`+ ${otherCount(role)} site-wide permissions`}
												</span>
											)}
										</Table.Cell>
										<Table.Cell>
											<RoleBadge role={role.compatibilityLevel} />
										</Table.Cell>
										<Table.Cell className="text-sm tabular-nums">{role.userCount}</Table.Cell>
										<Table.Cell>
											<div className="flex justify-end gap-1">
												<Button
													variant="ghost"
													size="sm"
													shape="square"
													icon={<PencilSimple aria-hidden="true" />}
													aria-label={t`Edit ${role.label}`}
													onClick={() => setEditor({ mode: "edit", role })}
												/>
												<Button
													variant="ghost"
													size="sm"
													shape="square"
													icon={<Trash aria-hidden="true" />}
													aria-label={t`Delete ${role.label}`}
													onClick={() => setPendingDelete(role)}
												/>
											</div>
										</Table.Cell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</div>
				)}
			</section>

			<section aria-labelledby="builtin-roles-heading" className="space-y-3">
				<h2 id="builtin-roles-heading" className="text-lg font-semibold">
					{t`Built-in roles`}
				</h2>
				<div className="overflow-x-auto rounded-md border border-kumo-line">
					<Table>
						<Table.Body>
							{ROLE_ENTRIES.map((entry) => (
								<Table.Row key={entry.value}>
									<Table.Cell className="w-40">
										<RoleBadge role={entry.value} />
									</Table.Cell>
									<Table.Cell className="text-sm text-kumo-subtle">
										{t(entry.description)}
										{entry.value === 50 && (
											<Badge variant="neutral" className="ms-2 text-xs">
												{t`Manages users and roles`}
											</Badge>
										)}
									</Table.Cell>
									<Table.Cell className="w-56">
										<div className="flex justify-end">
											<Button
												variant="ghost"
												size="sm"
												icon={<CopySimple aria-hidden="true" />}
												disabled={catalog.length === 0}
												onClick={() =>
													setEditor({ mode: "create", template: builtInTemplate(entry.value) })
												}
											>
												{t`Start a role from this`}
											</Button>
										</div>
									</Table.Cell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</div>
			</section>

			<RoleEditorDialog
				open={editor.mode !== "closed"}
				onOpenChange={(open) => {
					if (!open) {
						setEditor({ mode: "closed" });
						saveMutation.reset();
					}
				}}
				role={editor.mode === "edit" ? editor.role : null}
				template={editor.mode === "create" ? editor.template : undefined}
				catalog={catalog}
				collections={collections}
				isSaving={saveMutation.isPending}
				error={saveMutation.error}
				onSave={(input) => saveMutation.mutate(input)}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onClose={() => {
					setPendingDelete(null);
					deleteMutation.reset();
				}}
				title={t`Delete role?`}
				description={
					pendingDelete
						? t`"${pendingDelete.label}" will be removed. A role that users, invites or signup domains still use cannot be deleted.`
						: ""
				}
				confirmLabel={t`Delete`}
				pendingLabel={t`Deleting…`}
				variant="destructive"
				isPending={deleteMutation.isPending}
				error={deleteMutation.error}
				onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
			/>
		</div>
	);
}
