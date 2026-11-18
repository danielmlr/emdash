import { defineFleet } from "@emdash-cms/fleet";

export default defineFleet({
	name: "example-agency",
	defaults: { layout: "shared", groups: ["clients"] },
	sites: {
		bakery: { url: "https://bakery.example.com" },
		harbour: {
			layout: "repo",
			url: "https://harbour.example.com",
			groups: ["clients", "priority"],
		},
		lantern: { url: "https://lantern.example.org", groups: [] },
	},
});
