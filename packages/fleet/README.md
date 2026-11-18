# @emdash-cms/fleet

Run many EmDash sites from one site list. Each site stays an ordinary EmDash site with its own deployment, database, media storage and users. `fleet.config.ts` names every site, and the `emdash-fleet` command reads it.

This release has one command, `list`.

## Requirements

Node.js 22.18 or later. The command loads `fleet.config.ts` with Node.js's built-in type stripping, so the config needs no build step. Type stripping runs only erasable TypeScript syntax: an `enum` or a `namespace` in the config stops it from loading.

## Install

```sh
npm install --save-dev @emdash-cms/fleet
```

## The site list

The following `fleet.config.ts` lists two sites that one shared project builds and one site with its own repository:

```ts title="fleet.config.ts"
import { defineFleet } from "@emdash-cms/fleet";

export default defineFleet({
	name: "example-agency",
	defaults: { layout: "shared", groups: ["clients"] },
	sites: {
		bakery: { url: "https://bakery.example.com" },
		corner: { url: "https://corner.example.com" },
		harbour: {
			layout: "repo",
			url: "https://harbour.example.com",
			groups: ["clients", "priority"],
		},
	},
});
```

- `name` identifies the fleet. Don't change it once sites exist.
- `sites` is keyed by the site key: up to 40 lower-case letters, digits and hyphens, starting with a letter. A key never changes and never names another site.
- `url` is the site's address, `http` or `https`.
- `layout` is `shared` for a site built from the shared project, or `repo` for a site with its own repository. Every site needs one, from its entry or from `defaults`.
- `groups` names the groups the site belongs to.
- `defaults` applies to every site that doesn't set the key itself. A site's own `groups` replace the default groups.

The config is a TypeScript module, so it can compute sites, import a list from another file or read environment variables. Loading it runs its code.

## Commands

Every command looks for `fleet.config.ts` in the working directory. `--config <path>` names another file.

### `list`

Prints the sites from the config in the order the config lists them. It makes no network call.

```sh
npx emdash-fleet list
```

```txt
KEY      URL                          LAYOUT  GROUPS
bakery   https://bakery.example.com   shared  clients
corner   https://corner.example.com   shared  clients
harbour  https://harbour.example.com  repo    clients, priority
```

`--json` prints the command result instead: the command name, one object per site with its key, URL, layout and groups, and a summary.

### Exit codes

| Code | Meaning                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| 0    | The command finished.                                                                                             |
| 2    | The command stopped before doing anything: no config, a config that doesn't load or validate, or wrong arguments. |

## Library

Each command is also a function that returns the command result, for tools that call it without the CLI:

```ts
import { list, loadFleetConfig } from "@emdash-cms/fleet";

const fleet = await loadFleetConfig({ cwd: "/path/to/fleet" });
const result = list(fleet);
```

`loadFleetConfig()` throws a `FleetConfigError` with a `code` when the config is missing, doesn't load or is invalid. For an invalid config, the message names the path of the first wrong value, such as `sites.bakery.url`.
