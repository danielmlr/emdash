# Custom roles demo

A blog starter with a `jobs` collection and four custom roles, for the
custom-roles proof of concept. It runs on Node.js with SQLite and the local
storage adapter.

## Run it

From the repository root, build the packages once, then start the site:

```bash
pnpm build
pnpm --filter emdash-demo-custom-roles dev
```

Set up the site and sign in as the development admin by opening
<http://localhost:4325/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin>.
The setup applies `seed/seed.json`, which creates the collections, the sample
content and the custom roles.

Then create the personas:

```bash
pnpm --filter emdash-demo-custom-roles personas
```

The script prints one sign-in link per persona. The links use the development
bypass, which only exists while `astro dev` runs.

## Personas

| Persona | Role                 | What to look at                                                                                                                                                                 |
| ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sam     | `jobs-editor`        | The sidebar shows Jobs and Media only. Sam can create, edit, publish and delete any job. Opening `/_emdash/admin/content/posts` shows "Access Denied", and the API answers 403. |
| Pat     | `jobs-writer`        | Pat can create jobs and edit their own drafts, but the editor offers no Publish or Schedule button, and Pat's entries stay drafts.                                              |
| Robin   | `byline-editor`      | The Subscriber permissions plus `bylines:manage`, the case from emdash-cms/emdash#2332. Robin sees the collections read-only and can edit bylines.                              |
| Kim     | `site-editor`        | Editor permissions without menus, widgets and sections. Level checks see Kim as an Author.                                                                                      |
| Alex    | built-in Editor      | Unchanged behavior, for comparison.                                                                                                                                             |
| Chris   | built-in Contributor | Unchanged behavior. The editor is now read-only for entries Chris cannot edit, instead of failing on autosave.                                                                  |

The development admin manages roles under **Roles** in the sidebar.
