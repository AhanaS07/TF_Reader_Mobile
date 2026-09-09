# Fail-closed audit — the four cases in one place

Phase 1a of `thisWeek.md`. Each of the four fail-closed guarantees already exists and is already
pinned by a test — they were just scattered across three files with no single place saying "these
are the four, and here is where each one is proven." This is that place. It is a map, not new
behaviour: every row below points at code and a test that were there before this file was.

Update this table in the same change that adds, moves, or renames any of the citations below —
same discipline as `CONTRACT_ALIGNMENT.md`'s ledger.

| # | Case | Fails closed by throwing | Enforced at | Pinned by |
| - | ---- | ------------------------- | ------------ | --------- |
| 1 | Checksum/length mismatch | `DownloadError.CHECKSUM_MISMATCH` | `downloadManager.ts:280-293`, `openBook.ts:110` — cross-checks `session.content.originalLength` against the actual fetched byte length (no real checksum exists on the wire; see `CONTRACT_ALIGNMENT.md`'s `B_ok4`) | `downloadManager.test.ts:526-548`, `openBook.test.ts:220-227` |
| 2 | Expiry (offline licence) | `DownloadError.ENTITLEMENT_EXPIRED` | `licenseCheck.ts`'s `offlineFallback()` — an explicit expired licence, and the 4-day offline cap anchored on `lastValidatedAt` (`computeOfflineLicenceExpiry`) | `licenseCheck.test.ts`'s `computeOfflineLicenceExpiry` describe block + `offlineFallback` 4-day-cap tests |
| 3 | Keystore/keychain unavailable | `ContentFailure(ContentError.KEYSTORE_UNAVAILABLE)` | `contentStore.ts:442-446` — `unwrapBek()` failure is caught and re-thrown as this code rather than swallowed; Elite tier never calls the keychain at all (`contentStore.ts:433`) | `contentStore.test.ts:253-270,677-689` |
| 4 | Tampered persisted licence | `ContentError.LICENCE_INVALID` | `contentStore.ts`'s `decryptBook()` — decrypts a seal over the licence (`licenceSeal.ts`), sealed with the book's own BEK, and trusts THAT copy for expiry instead of the hand-editable plaintext in meta.json | `contentStore.edgecases.test.ts`'s "licence seal (Option C)" block; `licenceSeal.test.ts` |

## Row 2's history — the 4-day cap was dead code until 2026-09-03, not just untested

Worth recording plainly: this row previously cited a real function (`computeOfflineLicenceExpiry`)
and a real test file, and both existed — but the function computed `Date.now() + 4 days` INSIDE
itself, called moments before `offlineFallback()` compared that result to `Date.now()` again. Those
two calls are effectively the same instant, so the comparison could never be true. Every previously
downloaded book could be read offline indefinitely without ever re-contacting the server — silently,
with a passing test suite, because the tests that existed measured the function's output shape, not
whether a genuinely stale anchor could make it expire (one test's own comment even said so: it
described wanting to test "the 4-day window has elapsed" and then explained why it couldn't, and
tested something else instead). Fixed as part of building online licence rollover (`thisWeek.md`
Phase 3): the function now takes a PERSISTED `lastValidatedAt` anchor instead of recomputing `now`
internally, and a dedicated test proves the anchor is actually used (`licenseCheck.test.ts`'s
"ANCHORS ON lastValidatedAt, not Date.now()" test). Same lesson as row 4's history below: a
plausible-looking check that was never actually exercised end-to-end is the same as no check.

## Row 4's history — an RS256 wiring path existed here and was removed, not just left stubbed

Until 2026-09-03 this row was split into two: 4a was `checkLicense()` rejecting with
`KEY_SUBSTITUTION` if `verifyLicenceSignature()` ever returned `false`, and 4b was the seal below.
4a is gone now, not just unused — **B4** (`CONTRACT_ALIGNMENT.md`) got a Gate answer that day: no
signed licence exists in this system, so `SignedLicence.signature` was deleted (not left as a
placeholder) and renamed to `LocalLicenceRecord`, and `licenceSignature.ts`'s RS256 stub plus both
its call sites in `licenseCheck.ts` were deleted with it. There is nothing left to wire — a check
against a field that no longer exists isn't a stub, it's dead code, so it was removed rather than
kept "for when B4 unblocks."

**What this means for row 4 as it stands**: it answers only "has this device's own copy of the
licence been tampered with since it was stored," never "did flambeau issue this licence" — B4's
answer means the second question no longer has an intended implementation to wait for. See
`licenceSeal.ts`'s header for the exact trust-on-first-use window this accepts (sealed lazily, on
first genuine key access, not at download time — `store()` must stay keystore-free, several
existing tests pin that) and its ceiling (the sealing key lives on-device; a real signature from a
server whose private key never touches the device would have been strictly stronger, but nobody is
building that signer).

## Why this lives here and not in `API_CONTRACT_NOTES.md`

The `B*`/`C*` ledger in `CONTRACT_ALIGNMENT.md` and the per-capability `API_CONTRACT_NOTES.md`
files track *divergences from another team's published contract*. Fail-closed behaviour isn't a
contract question — cases 1, 2 and 3 need no other team's sign-off, and case 4's only
contract-shaped dependency (B4) is already tracked over there and linked above, not duplicated
here.
