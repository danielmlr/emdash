import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url));
const AGENCY = fileURLToPath(new URL("fixtures/agency", import.meta.url));

// Node.js before 22.18 runs TypeScript only behind this flag.
const STRIP_TYPES = process.features.typescript ? [] : ["--experimental-strip-types"];

function runCli(args: string[], cwd: string, nodeFlags: string[] = STRIP_TYPES) {
	return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
		execFile(
			process.execPath,
			["--no-warnings", ...nodeFlags, CLI, ...args],
			{ cwd, env: { ...process.env, NO_COLOR: "1" } },
			(error, stdout, stderr) => {
				resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
			},
		);
	});
}

describe("emdash-fleet list", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await realpath(await mkdtemp(join(tmpdir(), "emdash-fleet-")));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("prints every site with its URL, layout and groups, in config order", async () => {
		const result = await runCli(["list"], AGENCY);

		expect(result.code).toBe(0);
		expect(result.stdout.trimEnd().split("\n")).toEqual([
			"KEY      URL                          LAYOUT  GROUPS",
			"bakery   https://bakery.example.com   shared  clients",
			"harbour  https://harbour.example.com  repo    clients, priority",
			"lantern  https://lantern.example.org  shared  -",
		]);
	});

	it("prints the command result as JSON", async () => {
		const result = await runCli(["list", "--json"], AGENCY);

		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			command: "list",
			sites: [
				{
					key: "bakery",
					status: "done",
					steps: [],
					url: "https://bakery.example.com",
					layout: "shared",
					groups: ["clients"],
				},
				{
					key: "harbour",
					status: "done",
					steps: [],
					url: "https://harbour.example.com",
					layout: "repo",
					groups: ["clients", "priority"],
				},
				{
					key: "lantern",
					status: "done",
					steps: [],
					url: "https://lantern.example.org",
					layout: "shared",
					groups: [],
				},
			],
			summary: { done: 3, failed: 0, skipped: 0, waiting: 0 },
		});
	});

	it("reads the config named with --config from another directory", async () => {
		const result = await runCli(["list", "--config", join(AGENCY, "fleet.config.ts")], dir);

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("harbour");
	});

	it("exits 2 when the working directory has no fleet.config.ts", async () => {
		const result = await runCli(["list"], dir);

		expect(result.code).toBe(2);
		expect(result.stderr).toContain(`No fleet.config.ts in ${dir}`);
		expect(result.stdout).toBe("");
	});

	it("exits 2 when the file named with --config doesn't exist", async () => {
		const result = await runCli(["list", "--config", "sites/fleet.config.ts"], dir);

		expect(result.code).toBe(2);
		expect(result.stderr).toContain(join(dir, "sites/fleet.config.ts"));
	});

	it("exits 2 without a stack trace when the config doesn't parse", async () => {
		await writeFile(join(dir, "fleet.config.ts"), "export default {\n");

		const result = await runCli(["list"], dir);

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("Couldn't load");
		expect(result.stderr).not.toMatch(/\n\s+at /);
	});

	it("exits 2 when the config throws while it loads", async () => {
		await writeFile(
			join(dir, "fleet.config.ts"),
			'throw new Error("EMDASH_SITES is not set");\nexport default {};\n',
		);

		const result = await runCli(["list"], dir);

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("EMDASH_SITES is not set");
	});

	it("exits 2 and names the wrong value when the config is invalid", async () => {
		await writeFile(
			join(dir, "fleet.config.ts"),
			'export default { name: "agency", sites: { bakery: { url: "bakery.example.com", layout: "shared" } } };\n',
		);

		const result = await runCli(["list"], dir);

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("sites.bakery.url: must be an http or https URL");
		expect(result.stdout).toBe("");
	});

	it("exits 2 when the config has no default export", async () => {
		await writeFile(join(dir, "fleet.config.ts"), "export const sites = {};\n");

		const result = await runCli(["list"], dir);

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("has no default export");
	});

	it("exits 2 and names the Node.js version it needs when Node.js can't run TypeScript", async () => {
		const result = await runCli(["list"], AGENCY, ["--no-experimental-strip-types"]);

		expect(result.code).toBe(2);
		expect(result.stderr).toContain("Use Node.js 22.18 or later");
		expect(result.stdout).toBe("");
	});
});

describe("emdash-fleet", () => {
	it.each([[[]], [["deploy-all"]]])("exits 2 for the arguments %j", async (args) => {
		const result = await runCli(args, AGENCY);

		expect(result.code).toBe(2);
	});
});
