---
"@emdash-cms/admin": patch
---

Updates the entry editor, content list, media library, comments inbox and settings pages to read the permissions from `GET /_emdash/api/auth/me` instead of comparing the role level. What each built-in role is offered doesn't change.
