# Commits under my name that aren't actually my work

**Re-checked 2026-08-13: still current.** No new commits have landed on `T4_Abhinav` since this
was last compiled — this session's work (the download-flow bug fixes, the base64 decode fix, the
flambeau contract review) is staged but not yet committed, so there's nothing new to audit here
yet. Re-run this check after the next commit.

Went through every commit on this branch (`T4_Abhinav`, formerly `Abhinav_T4`) authored as "Abhinav." Below are the ones where the content is someone else's module/feature, not something built in our sessions together — even though git attributes them to me.

Method: cross-checked each commit's diff against what was actually built in our sessions vs. teammate ownership (Sync = Karthik, Personalization = Vaishnavi, Search index fixtures = pre-existing).

## Fully someone else's work, committed under my name

- **`c6e23ab`** — "feat(sync): implement synchronization logic" — Karthik's Sync module: `api.ts`, `db/database.ts`, repositories, `syncManager.ts`, `useConnectivity.ts`, plus the `frontend/src/sync` → `src/features/sync` restructuring.
- **`c0ba6e9`** — "feat(sync): enhance serverHasDiverged to maintain outbox integrity for local edits" — Sync logic, Karthik's module.
- **`9e1d24a`** — "Implement contentStore for AES-256-GCM encryption and decryption" — the base `contentStore.ts` (407 lines) landed as a merge from `dev_T4`; I did not build most of this.
- **`c2da7bd`** — "feat(encryption): implement RSA-OAEP-256 key wrapping and unwrapping" — the real `deviceKeypair.ts` RSA-OAEP-256 wrap/unwrap logic; landed via `dev_T4` merge, not built by me.

## Mixed — bundles my actual work with teammates' work in one commit

- **`61d5968`** — "feat(tests): add edge-case tests for contentStore and prefsStore, enhance syncManager and useConnectivity tests" — the `contentStore.edgecases.test.ts` piece is mine; `prefsStore.ts`/`prefsStore.test.ts` (Vaishnavi's personalization fix) and the `syncManager.test.ts`/`useConnectivity.test.ts` additions (Karthik's Sync) are not.
- **`d544eaf`** — "feat: add search index encryption and decryption functionality" — `contentProvider.ts`'s `getIndex()` and its tests are mine; `mockSearchIndex.ts`, `searchIndex.test.ts`, and `searchIndex.edgecases.test.ts` already existed and weren't authored by me.

## Not counted as an issue

- The 5 `Merge PR #...` commits (author `Abhinav-TF`, e.g. `5343f6c`, `daa1eb1`, `2252b3e`, `b17b55e`, `b74eae6`) are just GitHub's merge-button action on real PRs — merging is something you did yourself, not a claim of authorship over the merged content.
- `6cf54fd` (sql.js SQLite mock rewrite) touches Sync's mock file but was actually built and verified by me this session (Node-20 CI fix) — genuinely my work despite sitting in Sync's territory.
