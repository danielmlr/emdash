/**
 * Users management page
 *
 * Admin-only route for managing users, roles, and invites.
 */

import { useLingui } from "@lingui/react/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { ConfirmDialog } from "../components/ConfirmDialog.js";
import {
	UserList,
	UserListSkeleton,
	UserDetail,
	InviteUserModal,
	useRolesConfig,
} from "../components/users";
import { parseRoleKey } from "../components/users/useRolesConfig.js";
import {
	fetchUsers,
	fetchUser,
	updateUser,
	sendRecoveryLink,
	disableUser,
	enableUser,
	inviteUser,
	fetchManifest,
	type UpdateUserInput,
} from "../lib/api";
import { useRoles } from "../lib/api/roles.js";

/**
 * Debounce hook for search input
 */
function useDebounce<T>(value: T, delay: number): T {
	const [debouncedValue, setDebouncedValue] = React.useState(value);

	React.useEffect(() => {
		const timer = setTimeout(setDebouncedValue, delay, value);
		return () => clearTimeout(timer);
	}, [value, delay]);

	return debouncedValue;
}

export function UsersPage() {
	const { t } = useLingui();
	const { getRoleLabel } = useRolesConfig();
	const queryClient = useQueryClient();

	// State
	const [searchQuery, setSearchQuery] = React.useState("");
	const [roleFilter, setRoleFilter] = React.useState<string | undefined>();
	const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
	const [isDetailOpen, setIsDetailOpen] = React.useState(false);
	const [isInviteOpen, setIsInviteOpen] = React.useState(false);
	const [showDisableConfirm, setShowDisableConfirm] = React.useState(false);
	const [showDemoteConfirm, setShowDemoteConfirm] = React.useState(false);
	const [pendingSaveData, setPendingSaveData] = React.useState<UpdateUserInput | null>(null);
	const [inviteError, setInviteError] = React.useState<string | null>(null);
	const [inviteUrl, setInviteUrl] = React.useState<string | null>(null);

	// Debounced search
	const debouncedSearch = useDebounce(searchQuery, 300);

	// Queries
	const { data: manifest } = useQuery({ queryKey: ["manifest"], queryFn: fetchManifest });
	const customRoles = useRoles(true).data?.items ?? [];
	const pendingRoleLabel =
		pendingSaveData?.roleId !== undefined
			? (customRoles.find((role) => role.id === pendingSaveData.roleId)?.label ?? t`Custom role`)
			: getRoleLabel(pendingSaveData?.role ?? 0);

	const usersQuery = useInfiniteQuery({
		queryKey: ["users", debouncedSearch, roleFilter],
		queryFn: ({ pageParam }) =>
			fetchUsers({
				search: debouncedSearch || undefined,
				...(roleFilter ? parseRoleKey(roleFilter) : {}),
				cursor: pageParam,
			}),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor,
	});

	const userDetailQuery = useQuery({
		queryKey: ["users", selectedUserId],
		queryFn: () => fetchUser(selectedUserId!),
		enabled: !!selectedUserId,
	});

	// Mutations
	const updateUserMutation = useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateUserInput }) => updateUser(id, data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["users"] });
			setShowDemoteConfirm(false);
			setPendingSaveData(null);
		},
	});

	const disableMutation = useMutation({
		mutationFn: (id: string) => disableUser(id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["users"] });
			setShowDisableConfirm(false);
		},
	});

	const enableMutation = useMutation({
		mutationFn: (id: string) => enableUser(id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["users"] });
		},
	});

	const recoveryMutation = useMutation({
		mutationFn: (id: string) => sendRecoveryLink(id),
		onSuccess: () => {
			// Auto-clear success status after a few seconds
			setTimeout(() => recoveryMutation.reset(), 4000);
		},
	});

	const inviteMutation = useMutation({
		mutationFn: ({ email, roleKey }: { email: string; roleKey: string }) => {
			const { role, roleId } = parseRoleKey(roleKey);
			return inviteUser(email, role, roleId);
		},
		onSuccess: (result) => {
			setInviteError(null);
			if (result.inviteUrl) {
				// No email provider — show copy-link view in the modal
				setInviteUrl(result.inviteUrl);
			} else {
				// Email sent — close modal
				setIsInviteOpen(false);
			}
			// Refresh user list (invite token was created either way)
			void queryClient.invalidateQueries({ queryKey: ["users"] });
		},
		onError: (error: Error) => {
			setInviteError(error.message);
		},
	});

	// Handlers
	const handleSelectUser = (id: string) => {
		setSelectedUserId(id);
		setIsDetailOpen(true);
	};

	const handleCloseDetail = () => {
		setIsDetailOpen(false);
		// Keep selectedUserId for a moment to prevent flicker
		setTimeout(setSelectedUserId, 200, null);
	};

	const handleSave = (data: UpdateUserInput) => {
		if (!selectedUserId) return;

		// Check for role demotion — require confirmation.
		// Guard: only check when user data is loaded (currentRole defined).
		// A custom role counts by the built-in level it is stored at.
		const currentRole = userDetailQuery.data?.role;
		const newLevel =
			data.roleId !== undefined
				? (customRoles.find((role) => role.id === data.roleId)?.compatibilityLevel ?? 0)
				: data.role;
		if (newLevel !== undefined && currentRole !== undefined && newLevel < currentRole) {
			setPendingSaveData(data);
			setShowDemoteConfirm(true);
			return;
		}

		updateUserMutation.mutate({ id: selectedUserId, data });
	};

	const handleConfirmDemote = () => {
		if (selectedUserId && pendingSaveData) {
			updateUserMutation.mutate({ id: selectedUserId, data: pendingSaveData });
		}
	};

	const handleDisable = () => {
		setShowDisableConfirm(true);
	};

	const handleConfirmDisable = () => {
		if (selectedUserId) {
			disableMutation.mutate(selectedUserId);
		}
	};

	const handleEnable = () => {
		if (selectedUserId) {
			enableMutation.mutate(selectedUserId);
		}
	};

	const handleSendRecovery = () => {
		if (selectedUserId) {
			recoveryMutation.mutate(selectedUserId);
		}
	};

	const handleInvite = (email: string, roleKey: string) => {
		setInviteError(null);
		inviteMutation.mutate({ email, roleKey });
	};

	// Loading state
	if (usersQuery.isLoading && !usersQuery.data) {
		return <UserListSkeleton />;
	}

	// Error state
	if (usersQuery.error) {
		return (
			<div className="rounded-lg border border-kumo-danger/50 bg-kumo-danger/10 p-6 text-center">
				<p className="text-kumo-danger">{t`Failed to load users: ${usersQuery.error.message}`}</p>
				<button
					onClick={() => usersQuery.refetch()}
					className="mt-4 text-sm text-kumo-link underline"
				>
					{t`Try again`}
				</button>
			</div>
		);
	}

	const users = usersQuery.data?.pages.flatMap((p) => p.items) ?? [];
	const selectedUser = userDetailQuery.data ?? null;

	return (
		<>
			<UserList
				users={users}
				isLoading={usersQuery.isFetching}
				hasMore={!!usersQuery.hasNextPage}
				searchQuery={searchQuery}
				roleFilter={roleFilter}
				onSearchChange={setSearchQuery}
				onRoleFilterChange={setRoleFilter}
				onSelectUser={handleSelectUser}
				onInviteUser={() => setIsInviteOpen(true)}
				onLoadMore={() => void usersQuery.fetchNextPage()}
			/>

			<UserDetail
				user={selectedUser}
				isLoading={userDetailQuery.isLoading}
				isOpen={isDetailOpen}
				isSaving={updateUserMutation.isPending}
				isSendingRecovery={recoveryMutation.isPending}
				recoverySent={recoveryMutation.isSuccess}
				recoveryError={recoveryMutation.error?.message ?? null}
				currentUserId={undefined} // Would come from session
				providerManagedName={manifest?.providerManagedName}
				onClose={handleCloseDetail}
				onSave={handleSave}
				onDisable={handleDisable}
				onEnable={handleEnable}
				onSendRecovery={handleSendRecovery}
			/>

			<InviteUserModal
				open={isInviteOpen}
				isSending={inviteMutation.isPending}
				error={inviteError}
				inviteUrl={inviteUrl}
				onOpenChange={(open) => {
					setIsInviteOpen(open);
					if (!open) {
						setInviteError(null);
						setInviteUrl(null);
					}
				}}
				onInvite={handleInvite}
			/>

			{/* Disable confirmation */}
			<ConfirmDialog
				open={showDisableConfirm}
				onClose={() => {
					setShowDisableConfirm(false);
					disableMutation.reset();
				}}
				title={t`Disable User?`}
				description={
					<Trans>
						Disabling <strong>{selectedUser?.name || selectedUser?.email}</strong> will prevent them
						from logging in until re-enabled. Their content will be preserved.
					</Trans>
				}
				confirmLabel={t`Disable User`}
				pendingLabel={t`Disabling...`}
				isPending={disableMutation.isPending}
				error={disableMutation.error}
				onConfirm={handleConfirmDisable}
			/>

			{/* Role demotion confirmation */}
			<ConfirmDialog
				open={showDemoteConfirm}
				onClose={() => {
					setShowDemoteConfirm(false);
					setPendingSaveData(null);
					updateUserMutation.reset();
				}}
				title={t`Demote User?`}
				description={
					<Trans>
						Change <strong>{selectedUser?.name || selectedUser?.email}</strong> from{" "}
						<strong>
							{selectedUser?.customRole?.label ?? getRoleLabel(selectedUser?.role ?? 0)}
						</strong>{" "}
						to <strong>{pendingRoleLabel}</strong>? They will lose access to higher-level features.
					</Trans>
				}
				confirmLabel={t`Demote User`}
				pendingLabel={t`Demoting...`}
				isPending={updateUserMutation.isPending}
				error={updateUserMutation.error}
				onConfirm={handleConfirmDemote}
			/>
		</>
	);
}
