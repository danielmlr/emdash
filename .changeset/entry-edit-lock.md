---
"emdash": minor
"@emdash-cms/admin": minor
---

Adds an edit lock per content entry, so two people no longer discover a collision only after both have done the work.

Opening an entry in the admin takes a lock on it. A second editor is told who has it and chooses between opening the entry read-only, where nothing they type can be lost to a refused save, and taking it over. A take-over is not silent: the previous holder's next save is refused and a banner tells them who took the entry and that their changes are no longer being saved.

The lease expires after seven minutes without a write, and every save on the entry, autosave included, extends it, so the lock costs no extra request while someone is typing. Leaving the editor releases it; closing the tab lets it lapse.

`PUT` and `DELETE` on `/_emdash/api/content/{collection}/{id}`, and its `/publish`, `/unpublish` and `/discard-draft` sub-routes, refuse a write against someone else's live lock with `409 ENTRY_LOCKED`, and the response's `error.details` names the holder. Pass `"overrideLock": true` in the request body to write anyway, or `?overrideLock=true` on `DELETE`, which has no body. The CLI exposes the same escape hatch as `--override-lock` on `content update`, `content delete`, `content publish` and `content unpublish`. The MCP content tools do not honour the lock yet.

Locks are per entry and per locale, so two translations of the same entry can be edited at once.

Take or read a lock directly through `GET`, `POST` and `DELETE` on `/_emdash/api/content/{collection}/{id}/lock`.

#### Turning it off

Locking is on for every collection. Switch it off under **Content Types** → your collection → **Edit locking**, with `editLocking: false` in a seed file, or through `schema_update_collection`:

```json
{ "slug": "posts", "editLocking": false }
```

#### Upgrading

Migration `075_entry_edit_locks` adds the `_emdash_entry_locks` table and an `edit_locking` column on `_emdash_collections`. Projects on the default `auto` runtime migration mode need no action; projects that migrate as a deployment step should run `emdash migrate` before deploying this version.
