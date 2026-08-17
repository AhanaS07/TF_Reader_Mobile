# API_CONTRACT_NOTES.md — Encryption

**Owner: Abhinav. Status as of `83f4e2e` (2026-08-17).**

What this directory owes the wokay/flambeau contracts, and what it currently claims that the
contracts do not support. Nothing here has been changed in your code.

**Read before** touching `contentStore.ts`'s licence or key-resolution logic,
`deviceKeypair.ts`'s fingerprint or wire encoding, or anything that reads
`EncryptionDescriptor`/`SignedLicence`. **Update in the same change** that closes an item.

- Ledger and cross-capability view: `src/shared/contracts/CONTRACT_ALIGNMENT.md`
- Full evidence: `src/shared/contracts/API_CONTRACT_REVIEW_CONTEXT.md`
- Download's list, which several of these pair with:
  `src/features/download/API_CONTRACT_NOTES.md`

---

## 1. `C7` 💬 — the fingerprint recipe is a guess, and it now fails closed

**This is the highest-priority item in this directory, and it is a question for wokay, not a code
change.**

`84f2476` closed `B3` properly. `publicKeyFingerprint()` (`deviceKeypair.ts:168`) derives the
fingerprint from the device's own public key, `downloadManager.ts` uses it for
`SignedLicence.keyFingerprint`, and so `assertLicenceMatchesPackage()`'s check at
`contentStore.ts:150` finally compares **our** derivation against **the server's claim** instead of
a value against itself. That is exactly the anti-key-substitution guarantee wokay mandates:

> `keyFingerprint*` — SHA-256 of the device public key this key was wrapped for. **Required, and the
> reader must compare it against its own key and refuse if it differs. That comparison is what
> proves nobody in the chain substituted a key, so it cannot be optional.**

The problem is what happens if the recipe is wrong. `publicKeyFingerprint()` picks:

| Decision | We chose | Could also be |
| --- | --- | --- |
| Digest input | the raw DER bytes (same bytes `publicKeyToRawBase64()` sends) | the base64 SPKI string |
| Prefix | literal `sha256:` | absent, or another label |
| Output | full 64-char lowercase hex | truncated, or base64 |

wokay's only published example is `"sha256:d5e91261"` — **eight** hex characters, so a truncated
illustration that settles none of the three. If any one differs, `contentStore.store()` throws
`ContentError.LICENCE_INVALID` on **every encrypted download**, permanently, from the first real
server contact.

Before `84f2476` the two sides both came from the server, so a mismatch was structurally
impossible. The same commit that fixed the security hole turned `C7` from a documentation question
into a hard integration blocker. **Get the answer from wokay before integration week.**

Two things to fix regardless of the answer:

- **The check runs after the download.** `session.encryption.keyFingerprint` is available the
  instant `openReadingSession` returns; the comparison happens inside `store()`, after
  `fetchEncryptedAsset` has pulled up to 25 MB. Comparing early fails in milliseconds and raises a
  `DownloadError` at the right layer instead of a `ContentFailure` surfacing out of Encryption.
- **The failure code is generic.** `LICENCE_INVALID` covers expiry, itemId mismatch, malformed
  dates and now key substitution. A dedicated `KEY_SUBSTITUTION` would make the one case that means
  "someone tampered with the chain" distinguishable from "this licence is stale" in logs and in the
  UI. `shared/contracts/errors.ts` is frozen, so that's a Gate conversation.

---

## 2. `B4` 🔴 — `contentStore` is built around a licence no contract sends

`assertLicenceMatchesPackage()` (`contentStore.ts:117`) rejects `encryption && !licence` loudly, and
that rejection is correct given `EncryptedPackage`'s shape. But the object it demands **exists in
neither published contract**: wokay's `ContentGrant` is exactly `content` / `index` / `encryption`,
and flambeau's `ReadingSessionResponse` adds only session fields. Neither carries a licence, a
signature, or print rights. So `downloadManager.ts` synthesizes one per download purely to satisfy
this store.

What that means for code in this directory:

- **The RS256 trust path is decorative, and `contentStore.ts:24` and `:406` already say so.** The
  signature isn't verified, and the value is `''` anyway, so `ContentError.LICENCE_INVALID` can
  never fire for a signature. **This cannot be fixed here** — the server sends nothing to verify. It
  needs the contract to either add a signed licence or drop the pretence.
- **The open-access sentinel is a fail-open.** `'9999-12-31T23:59:59.000Z'` stands in for "never
  expires", and `isLicenceExpired()` only compares to `Date.now()`, so it works. But it means a bug
  that mis-tags a subscription book as open access grants a **perpetual** offline licence. A
  nullable `expiresAt` would fail closed instead. Worth raising when `B4` is ruled on.
- **`expiresAt` is the one field doing real work**, sourced correctly from `loan.dueAt`. Keep it.

The Gate decision (does a signed licence exist in this system at all?) and the recommendation are
written up in `src/shared/contracts/CONTRACT_ALIGNMENT.md` §B4. Read that before adding any field
to `SignedLicence` or building anything on `signature`.

---

## 3. `B15` 🟢 — the store can't defend itself against an unlicensed subscription audiobook

Both contracts say audio is never encrypted. `downloadManager.ts` keys `licence` off `encryption`,
so a `SUBSCRIPTION`-tier audio title arrives with `encryption: null` → `licence: null`, and this
store then treats it as open access: persists it, and `isLicenceExpired()` short-circuits to "not
expired". A subscription audiobook sits on the device permanently, outliving the subscription.

The fix belongs in `downloadManager.ts` (derive from `loan.canPersist` + `loan.licenceModel`, not
from `encryption != null`) — see Download's notes. **The reason it's listed here too:** this store's
own invariant, "encrypted ⇒ must ship a licence", is the wrong invariant for the audio case. There
is no combination of flags a caller can pass today that means "unencrypted but still licensed and
expiring." If you close `B15` in `downloadManager.ts`, `assertLicenceMatchesPackage()` needs a
matching rule, or the store will keep accepting the package it should refuse.

---

## 4. `B11` 🟡 — the 25 MB ceiling is ours alone

`contentStore.ts:41` sets `MAX_DECRYPTED_BYTES = 25 * 1024 * 1024`, and `downloadManager.ts` rejects
an over-budget book with `BOOK_TOO_LARGE` **before** storing. Rejecting early is right — a stored
oversized book burns one of the five offline slots and throws on every open.

But **nothing in either contract bounds book size.** `SignedUrl.originalLength` is just
`integer ≥ 1`, and wokay's ingest endpoint has no max-size validation. So an operator can publish a
40 MB book that this client can never open, with no signal at either end.

The number is not arbitrary — `CLAUDE.md` records a measured 20 MB EPUB producing a **609 MB app RSS
peak**, on a simulator with no jetsam, where ~985 MB combined would likely be a foreground kill on a
2 GB device. 25 MB is close to the real ceiling.

**Ask wokay** to document a maximum ingest size, or to give the client a capability hint before
download so large titles can be marked stream-only. `hasSearchIndex` is the precedent for exactly
that kind of hint.

---

## 5. Still open from `CLAUDE.md`, and now contract-relevant

These three predate the contract review and are unchanged. Two of them interact with items above.

1. ~~**Stale keychain-cached BEK.**~~ **Closed** — `store()` now clears the cached BEK when the
   incoming `wrappedBek` differs from the persisted one (`invalidateStaleCachedKeyIfRotated`,
   `contentStore.ts:206`), and `contentStore.edgecases.test.ts` pins the fix rather than the defect.
   Kept on this list only to note **why it matters more under the real contract than it did under
   the mock**: every book open requests a fresh reading session (`B7`), and a server that rotates
   its master key — `encryption.keyId` exists precisely so "a second one can be added later" —
   hands back a new `wrappedBek` for a book already on the device. That rotation path is exactly
   what the fix covers, so it should hold; it has just never been exercised against a real
   rotating server. Worth a deliberate test when `B2` lands.
2. **`close()` leaves the ciphertext resident** — it doesn't touch the module-level `packageCache`,
   so 20 MB of ciphertext stays in RAM indefinitely after `closeBook()`. Reader has no legitimate
   workaround; the one-line fix is `packageCache.delete(bookId)` inside `close()`, and it is a real
   trade-off (next open becomes a cold 20 MB synchronous `bytesSync()`), which is why it's your
   call.
3. ~~**The `aesGcm.ts` base64 hop dominates a warm open.**~~ **Closed by your own `47bc4ce`** —
   swapping `aesGcm.ts` to `react-native-quick-base64` took `decrypt` on a 20 MB book from ~4900 ms
   to **104–118 ms** (re-measured 2026-08-17, iPhone 17 Pro simulator). Doing it in `aesGcm.ts`
   rather than inside `base64.ts` was the better call: `base64.ts` stays the portable,
   no-native-dependency fallback its header promises.

   **What remains is the peak, and it is unmoved: 631 MB app RSS on that same book.** Opening still
   materialises the payload at full size ~six times, and making each copy 30x faster changes none
   of that. This is now the only lever left on app-side memory, and it is a design change — a
   bytes-in/bytes-out native API, or streaming — not another codec swap. `MAX_DECRYPTED_BYTES`
   (§4 above) is the guard rail standing in for it today.

---

## Do not "fix" these

| # | Thing | Why it's right |
| --- | --- | --- |
| `B_ok1` | `publicKeyToRawBase64()` — strips PEM armour to 392 chars for RSA-2048, which **is** base64 SPKI DER, exactly wokay's spec. flambeau's looser "base64 of raw bytes" prose (`A6`) is the thing that's wrong. Do not change the encoding to match it | `deviceKeypair.ts` |
| — | `resolveRawKey()` comparing `wrappedBek` itself rather than `keyFingerprint`/`keyId` for BEK-change detection. `keyFingerprint` identifies the **device** key, `keyId` names a **server** key; neither changes when the BEK does | `contentStore.ts:198` |
| — | `keyId` is now optional on `EncryptionDescriptor`, matching wokay's schema (`A7`). Nothing reads it, and it must stay that way — it names a server key, not an identity to branch on | `shared/contracts/content-provider.ts` |
| — | The keypair-cache revert documented at `deviceKeypair.ts:77`. Caching the derived public key across calls broke 13 tests that drive sequential keychain states on purpose. Revisit only with a test-only reset hook, and only against a measured cost | `deviceKeypair.ts` |
