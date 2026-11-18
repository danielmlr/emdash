---
"@emdash-cms/fleet": minor
---

Adds `@emdash-cms/fleet`, a command-line tool for running many EmDash sites from one site list in `fleet.config.ts`. This first release has `emdash-fleet list`, which prints each site's key, URL, layout and groups, as a table or with `--json`. The tool needs Node.js 22.18 or later, because it loads the TypeScript config through Node.js's type stripping.
