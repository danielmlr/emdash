---
"@emdash-cms/auth": minor
"emdash": patch
---

Adds the `auth:manage_api_tokens` and `auth:manage_oauth_clients` permissions to `Permissions` in `@emdash-cms/auth`, both held by the Admin role. The user, invite, allowed-domain, API token and OAuth client routes now check a permission name instead of the role level, and access for the built-in roles doesn't change. A refused caller still gets status 403 with the code `FORBIDDEN`; the message is now "Insufficient permissions".
