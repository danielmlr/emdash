import { describe, expect, it } from "vitest";

import { FleetConfigError, resolveFleetConfig } from "../src/config.js";

const PATH = "/fleet/fleet.config.ts";

function configError(value: unknown): FleetConfigError {
	try {
		resolveFleetConfig(value, PATH);
	} catch (error) {
		if (error instanceof FleetConfigError) return error;
		throw error;
	}
	throw new Error("expected the config to be rejected");
}

describe("resolveFleetConfig", () => {
	it("keeps the sites in the order the config lists them", () => {
		const fleet = resolveFleetConfig(
			{
				name: "agency",
				defaults: { layout: "shared" },
				sites: {
					mill: { url: "https://mill.example.com" },
					bakery: { url: "https://bakery.example.com" },
					harbour: { url: "https://harbour.example.com" },
				},
			},
			PATH,
		);

		expect(fleet.sites.map((site) => site.key)).toEqual(["mill", "bakery", "harbour"]);
	});

	it("applies defaults to sites that don't set the key themselves", () => {
		const fleet = resolveFleetConfig(
			{
				name: "agency",
				defaults: { layout: "shared", groups: ["clients"] },
				sites: {
					bakery: { url: "https://bakery.example.com" },
					harbour: { url: "https://harbour.example.com", layout: "repo", groups: ["priority"] },
					lantern: { url: "https://lantern.example.com", groups: [] },
				},
			},
			PATH,
		);

		expect(fleet.sites).toEqual([
			{ key: "bakery", url: "https://bakery.example.com", layout: "shared", groups: ["clients"] },
			{ key: "harbour", url: "https://harbour.example.com", layout: "repo", groups: ["priority"] },
			{ key: "lantern", url: "https://lantern.example.com", layout: "shared", groups: [] },
		]);
	});

	it("loads a config that sets fields later commands read", () => {
		const provider = { name: "cloudflare", deploy: () => ({ deploymentId: "1" }) };
		const config = {
			name: "agency",
			provider,
			repositoryHosts: [{ name: "github", origin: "https://github.com" }],
			namePrefix: "client",
			defaults: { layout: "shared", project: "./site", sharedBindings: ["CACHE"] },
			sites: {
				harbour: {
					layout: "repo",
					url: "https://harbour.example.com",
					repository: "https://github.com/example-agency/harbour-site",
					tokenEnv: "EMDASH_TOKEN_HARBOUR",
					resources: { database: "harbour-db" },
				},
			},
		};

		const fleet = resolveFleetConfig(config, PATH);

		expect(fleet.sites).toEqual([
			{ key: "harbour", url: "https://harbour.example.com", layout: "repo", groups: [] },
		]);
		expect(fleet.config).toBe(config);
	});

	it.each([
		{
			case: "a missing name",
			config: { sites: {} },
			path: "name:",
		},
		{
			case: "a site key with capitals",
			config: { name: "agency", sites: { Bakery: { url: "https://bakery.example.com" } } },
			path: "sites.Bakery: isn't a valid site key",
		},
		{
			case: "a URL that isn't http or https",
			config: { name: "agency", sites: { bakery: { url: "ftp://bakery.example.com" } } },
			path: "sites.bakery.url: must be an http or https URL",
		},
		{
			case: "an unknown layout",
			config: {
				name: "agency",
				sites: { bakery: { url: "https://bakery.example.com", layout: "mono" } },
			},
			path: "sites.bakery.layout:",
		},
		{
			case: "a group that isn't a string",
			config: {
				name: "agency",
				defaults: { layout: "shared" },
				sites: { bakery: { url: "https://bakery.example.com", groups: ["clients", 2] } },
			},
			path: "sites.bakery.groups[1]:",
		},
		{
			case: "a site without a layout in the entry or the defaults",
			config: { name: "agency", sites: { bakery: { url: "https://bakery.example.com" } } },
			path: "sites.bakery.layout: is missing",
		},
	])("names the path of $case", ({ config, path }) => {
		const error = configError(config);

		expect(error.code).toBe("CONFIG_INVALID");
		expect(error.message).toContain(`${PATH}: ${path}`);
	});

	it("names the first wrong value when there are several", () => {
		const error = configError({
			name: "agency",
			defaults: { layout: "shared" },
			sites: {
				bakery: { url: "https://bakery.example.com" },
				harbour: { url: "not a url" },
				lantern: { url: "also not a url" },
			},
		});

		expect(error.message).toContain("sites.harbour.url");
		expect(error.message).not.toContain("lantern");
	});
});
