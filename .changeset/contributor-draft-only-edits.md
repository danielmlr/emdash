---
"emdash": patch
---

Updates the REST API and the MCP server so a Contributor can discard the pending changes of their own draft, restore it from the trash, duplicate it, and create a translation of it. These four operations required the Author role before, although a Contributor could already create and save the same draft. A Contributor is still refused for a published or scheduled entry and for another user's entry. If the draft is published while one of these requests runs, the request fails with a conflict (`409` in REST, `CONFLICT` in MCP) and changes nothing.
