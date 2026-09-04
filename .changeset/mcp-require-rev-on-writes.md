---
"emdash": minor
---

Requires `_rev` on the MCP `content_update`, `content_publish`, `content_unpublish` and `content_discard_draft` tools, so an agent can no longer write over changes it never read. The CLI has always required the token on `content update`; the MCP surface now matches it.

An existing client must read the item with `content_get` and pass back the `_rev` it returns. A write built on a stale token fails with `CONFLICT`, and the caller should read the item again and retry. A call that omits `_rev` fails validation with a message naming `content_get`, and the tool descriptions state the same protocol so an agent reading the schema follows it without being told.
