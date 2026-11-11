---
"@emdash-cms/auth": minor
"emdash": minor
"@emdash-cms/admin": patch
---

Adds `permissions` to the response of `GET /_emdash/api/auth/me`: the names of the permissions the signed-in user holds. `@emdash-cms/auth` exports `permissionsForRole(role)`, which returns that list for a role. The admin sidebar, command palette, dashboard, header, settings pages, byline pages and media editor, and the visual editing toolbar, now read this list instead of comparing the role level. What each built-in role is offered doesn't change.
