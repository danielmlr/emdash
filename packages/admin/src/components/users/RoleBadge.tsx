import { Badge } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";
import { getRoleConfig } from "./roleDefinitions.js";

export type { RoleLevelConfig } from "./roleDefinitions.js";

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

export interface RoleBadgeProps {
	role: number;
	/** Shown instead of the built-in role when the user has a custom role. */
	customRole?: { label: string } | null;
	size?: "sm" | "md";
	showDescription?: boolean;
	className?: string;
}

/**
 * Maps a role's semantic color name to a Kumo Badge token variant, so
 * light/dark theming comes from tokens rather than hard-coded palette classes.
 */
const ROLE_VARIANTS: Record<string, BadgeVariant> = {
	gray: "neutral",
	blue: "blue",
	green: "green",
	purple: "purple",
	red: "red",
};

/**
 * Role badge component built on Kumo Badge semantic variants.
 */
export function RoleBadge({
	role,
	customRole,
	size = "sm",
	showDescription = false,
	className,
}: RoleBadgeProps) {
	const { t } = useLingui();
	const config = getRoleConfig(role);
	const sizeClassesForCustom = size === "md" ? "px-2.5 py-1 text-sm" : "text-xs";

	if (customRole) {
		return (
			<span title={t`Custom role`}>
				<Badge variant="teal" className={cn(sizeClassesForCustom, className)}>
					{customRole.label}
				</Badge>
			</span>
		);
	}

	const sizeClasses = {
		sm: "text-xs",
		md: "px-2.5 py-1 text-sm",
	};

	return (
		<span title={showDescription ? undefined : t(config.description)}>
			<Badge
				variant={ROLE_VARIANTS[config.color] ?? "neutral"}
				className={cn(sizeClasses[size], className)}
			>
				{t(config.label)}
				{showDescription && <span className="ms-1 opacity-75">- {t(config.description)}</span>}
			</Badge>
		</span>
	);
}
