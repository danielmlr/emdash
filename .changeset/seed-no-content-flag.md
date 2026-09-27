---
"emdash": patch
---

Fixes `emdash seed --no-content` applying the seed's content entries, bylines, and taxonomy terms anyway. The flag skips them as documented, so combining it with `--on-conflict update` no longer overwrites existing entries.

The undocumented camelCase `--noContent`, the only spelling that skipped content before this release, is ignored without an error. Scripts that use it must switch to `--no-content` or `--content=false`, or the command applies the seed's content.
