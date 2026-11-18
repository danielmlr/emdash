#!/usr/bin/env node
import { defineCommand, runCommand, showUsage, type CommandDef } from "citty";

import { CONFIG_FILE_NAME, FleetConfigError, loadFleetConfig } from "./config.js";
import { list, type ListedSite } from "./list.js";
import type { CommandResult } from "./result.js";

const EXIT_DONE = 0;
const EXIT_USAGE = 2;

const commonArgs = {
	config: {
		type: "string",
		valueHint: "path",
		description: `Path of the fleet config (default: ${CONFIG_FILE_NAME} in the working directory)`,
	},
	json: {
		type: "boolean",
		description: "Print the result as JSON",
	},
} as const;

function formatList(result: CommandResult<ListedSite>, configPath: string): string {
	if (result.sites.length === 0) return `${configPath} lists no sites.`;
	const rows = [
		["KEY", "URL", "LAYOUT", "GROUPS"],
		...result.sites.map((site) => [
			site.key,
			site.url,
			site.layout,
			site.groups.length > 0 ? site.groups.join(", ") : "-",
		]),
	];
	const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
	return rows
		.map((row) =>
			row
				.map((cell, column) => cell.padEnd(widths[column]!))
				.join("  ")
				.trimEnd(),
		)
		.join("\n");
}

const listCommand = defineCommand({
	meta: { name: "list", description: "List the sites in the fleet config" },
	args: commonArgs,
	async run({ args }) {
		const fleet = await loadFleetConfig({ config: args.config });
		const result = list(fleet);
		const output = args.json
			? JSON.stringify(result, null, 2)
			: formatList(result, fleet.configPath);
		process.stdout.write(`${output}\n`);
	},
});

const subCommands: Record<string, CommandDef> = {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- citty types each command by its own args; this map only finds a command by name
	list: listCommand as CommandDef,
};

const main = defineCommand({
	meta: { name: "emdash-fleet", description: "Run many EmDash sites from one site list" },
	subCommands,
});

async function run(rawArgs: string[]): Promise<number> {
	const name = rawArgs[0];
	const subCommand = name && Object.hasOwn(subCommands, name) ? subCommands[name] : undefined;
	if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
		await (subCommand ? showUsage(subCommand, main) : showUsage(main));
		return EXIT_DONE;
	}
	if (rawArgs.length === 0) {
		await showUsage(main);
		return EXIT_USAGE;
	}

	try {
		await runCommand(main, { rawArgs });
		return EXIT_DONE;
	} catch (error) {
		if (error instanceof FleetConfigError) {
			process.stderr.write(`emdash-fleet: ${error.message}\n`);
			return EXIT_USAGE;
		}
		if (error instanceof Error && error.name === "CLIError") {
			await (subCommand ? showUsage(subCommand, main) : showUsage(main));
			process.stderr.write(`emdash-fleet: ${error.message}\n`);
			return EXIT_USAGE;
		}
		throw error;
	}
}

process.exitCode = await run(process.argv.slice(2));
