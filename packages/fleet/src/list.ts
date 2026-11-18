import type { LoadedFleet, SiteLayout } from "./config.js";
import { commandResult, type CommandResult, type SiteResult } from "./result.js";

export interface ListedSite extends SiteResult {
	url: string;
	layout: SiteLayout;
	groups: string[];
}

/** The sites in the config, in its order. Makes no network call. */
export function list(fleet: LoadedFleet): CommandResult<ListedSite> {
	return commandResult(
		"list",
		fleet.sites.map((site) => ({
			key: site.key,
			status: "done" as const,
			steps: [],
			url: site.url,
			layout: site.layout,
			groups: site.groups,
		})),
	);
}
