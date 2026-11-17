---
"emdash": patch
---

Updates the MCP `media_create` tool so Contributors can confirm their own signed uploads, as they already can through the REST API and with `media_upload`. The tool required the Author role before. The other MCP tools now check the same permission names as their REST routes instead of a role level, and access for the built-in roles doesn't change.
