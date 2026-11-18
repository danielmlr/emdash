export type SiteStatus = "done" | "failed" | "skipped" | "waiting";

export interface SiteResult {
	key: string;
	status: SiteStatus;
	steps: { name: string; status: SiteStatus; detail?: string }[];
	version?: string;
	deploymentId?: string;
	error?: { code: string; message: string };
}

export interface CommandResult<Site extends SiteResult = SiteResult> {
	command: string;
	sites: Site[];
	summary: Record<SiteStatus, number>;
}

export function commandResult<Site extends SiteResult>(
	command: string,
	sites: Site[],
): CommandResult<Site> {
	const summary: Record<SiteStatus, number> = { done: 0, failed: 0, skipped: 0, waiting: 0 };
	for (const site of sites) summary[site.status]++;
	return { command, sites, summary };
}
