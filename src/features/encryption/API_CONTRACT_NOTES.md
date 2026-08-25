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

## 1. `C7` ✅ — CLOSED 2026-08-23: the fingerprint recipe was confirmed, not guessed wrong

`tf_reader_backend_temp` (the real backend) is now running locally (`:8080`) and testable directly,
not just readable-as-a-spec. Its `ContentAccessGrantImpl.fingerprintOf()`
(`content/service/ContentAccessGrantImpl.java`) is:

```java
byte[] digest = MessageDigest.getInstance("SHA-256").digest(devicePublicKey);
return "sha256:" + HexFormat.of().formatHex(digest);
```

— over the same raw SPKI DER bytes the request's `devicePublicKey` field carries. That is exactly
`publicKeyFingerprint()`'s (`deviceKeypair.ts:168`) guess, on all three axes:

| Decision | We chose | Confirmed against the real backend |
| --- | --- | --- |
| Digest input | the raw DER bytes | ✅ same bytes, digested server-side |
| Prefix | literal `sha256:` | ✅ literal, lowercase |
| Output | full 64-char lowercase hex | ✅ `HexFormat.formatHex` on a 32-byte digest |

**Verified live, not just read**: generated a real RSA-2048 keypair, sent its raw SPKI DER as
`devicePublicKey` in a real `POST /api/v1/reading-sessions` call (with a bearer token from
`/api/v1/auth/dev-token` — see `download/devAuthToken.ts`), and the response's
`encryption.keyFingerprint` matched an independent `sha256:` + `SHA256(raw DER).hex()` computed in
Python, byte for byte. No code change needed — `publicKeyFingerprint()` is correct as written.

Struck in `src/shared/contracts/CONTRACT_ALIGNMENT.md` in the same change.

---

## 1a. `B17` 🔴 — NEW 2026-08-23: the wrapped BEK does not actually decrypt (backend bug)

**This is now the highest-priority item in this directory — it isn't a guess, it's a reproduced
failure, and closing `C7` above only makes it more visible: the fingerprint check now correctly
passes, and the very next step (`unwrapBek()`) fails.**

The real backend's wrap (`ContentAccessGrantImpl.wrapBekForDevice()`) is:

```java
Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
cipher.init(Cipher.ENCRYPT_MODE, publicKey);
```

No `OAEPParameterSpec` is passed. This is a well-known `SunJCE` gotcha: the transformation string's
`...AndMGF1Padding` suffix only names the **OAEP** digest (SHA-256 here); the **MGF1** mask digest
defaults separately to **SHA-1** unless an explicit `OAEPParameterSpec` with
`MGF1ParameterSpec.SHA256` is supplied. So the real on-wire wrap is OAEP-SHA256 / MGF1-SHA1 — a
Java-specific combination — not "true" RSA-OAEP-256 (SHA-256 for both), which is what
`wrapAlgorithm: 'RSA-OAEP-256'` implies and what every other common implementation (WebCrypto,
OpenSSL's own EVP defaults when both are set explicitly) means by that name.

This app's `unwrapBek()` (`deviceKeypair.ts:219`, via `react-native-quick-crypto`) passes one
`oaepHash` option that the library ties to **both** the OAEP digest and MGF1 at the native/OpenSSL
layer (`HybridRsaCipher.cpp`, confirmed by reading the C++: the same `md` is set for both
`EVP_PKEY_CTX_set_rsa_oaep_md` and `EVP_PKEY_CTX_set_rsa_mgf1_md`). There is no way to request
mismatched digests through this app's crypto library, and there shouldn't be — matching digests is
the correct, standard behaviour.

**Verified empirically** (RSA-2048 keypair, real `wrappedBek` pulled from a live
`POST /api/v1/reading-sessions` response): decrypting with OAEP-SHA256/MGF1-**SHA1** recovers the
real 32-byte BEK and the fetched ciphertext then decrypts to a valid PDF. Decrypting with
OAEP-SHA256/MGF1-**SHA256** (what this app does, and what "RSA-OAEP-256" should mean) throws.

**This is not something to work around client-side.** Weakening this app's OAEP to
MGF1-SHA1-to-match would make it interoperate with this one prototype backend's bug and break
compatibility with any correctly-implemented RSA-OAEP-256 backend (including whatever wokay ships
for real). **The fix belongs on the backend**: pass an explicit
`OAEPParameterSpec(new PSource.PSpecified(...))` with `MGF1ParameterSpec.SHA256` to `cipher.init`.
Flag this with wokay/whoever owns `content/service/` in `tf_reader_backend_temp` — it is a one-line
fix on their side.

**Done when:** the same live-decrypt check above succeeds with matching SHA-256/SHA-256.

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
