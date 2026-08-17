# CONTRACT_ALIGNMENT.md — where we stand against wokay + flambeau

**Owner: Ahana (lead, `src/shared/contracts/`). Status as of `83f4e2e` (2026-08-17).**

This is the **status ledger** for the API contract review. It says, for every finding, whether it
is closed, who has to close it, and what breaks if nobody does. It is the index; the per-capability
detail lives in each feature's own `API_CONTRACT_NOTES.md`.

## The two documents this is measured against

| Doc | Teams | Source |
| --- | --- | --- |
| `API Documentation.pdf` | **wokay** — Onboarding & Admin (CAP-1), OPDS Catalogue (CAP-5) | `abhishek-tf.github.io/tf_reader_backend_temp/api-docs/wokay-api.html` |
| `flambeau_API Documentation.pdf` | **flambeau** — Auth (CAP-6), Borrow & personal library (CAP-4), read broker | `deepu1004.github.io/flambeau-api-contracts/` |

The full evidence base — every quote, every file:line, the field-level mapping tables — is
committed next to this file as **`API_CONTRACT_REVIEW_CONTEXT.md`**. Read that when you need the
*why*; read this when you need the *what's left*.

It is committed rather than linked because three tracked files used to cite a
`flambeau-contract-comparison.md` that has never existed on any branch of either repo. Citing a
document nobody can open is the failure mode this directory has already been bitten by once. If you
add a contract citation, cite a path that resolves.

Finding IDs (`A1`, `B4`, `C7`) are stable. Quote them in review comments and commit messages
instead of restating the problem.

---

## Read this first: the one that will stop integration

**`C7` — nobody has confirmed with wokay what a `keyFingerprint` actually is, and the code now
fails closed on getting it wrong.**

Commit `84f2476` correctly closed `B3`: `SignedLicence.keyFingerprint` is now derived from the
device's own public key (`deviceKeypair.ts`'s `publicKeyFingerprint()`) rather than copied from the
server's claim, so `contentStore.ts`'s comparison is a real anti-key-substitution check instead of
a value against itself. That is the right fix.

But the digest recipe is a **guess in three independent ways**, and wokay's only published example
is `"sha256:d5e91261"` — eight hex characters, so a truncated illustration that settles none of
them:

| Guess | What we chose | What else it could be |
| --- | --- | --- |
| Digest input | the raw DER bytes | the base64 SPKI string |
| Prefix | literal `sha256:` | absent, or another label |
| Length | full 64-char hex | truncated, or base64 |

If any one of the three differs, `contentStore.store()` throws `LICENCE_INVALID` on **every
encrypted download**, permanently, the first time this app talks to a real server. Before
`84f2476` a mismatch was structurally impossible, so this went from a documentation question to a
hard blocker in the same commit that fixed the security hole. **Ask wokay before integration
week, not during it.**

---

## Status by finding

Legend: ✅ closed · 🟡 partly done or deliberately accepted · ❌ open · 💬 needs another team's answer

### Register A — the two contracts contradicting each other

Not ours to fix. Listed because several `B` items cannot be closed until these are ruled on, and
because the app has already picked a side on two of them.

| # | Question | Status | Whose call |
| --- | --- | --- | --- |
| `A1` | One shared `ErrorCode` enum, two incompatible member lists (wokay excludes `TOKEN_EXPIRED`/`INSTITUTION_INACTIVE`; flambeau requires both, plus 5 unratified) | 💬 **we have taken flambeau's side**, recorded in `reading-session.ts`'s `FlambeauErrorCode` doc comment | Gate |
| `A2` | wokay: institutional sign-in is SAML-only. flambeau: ships SAML **and** OIDC | 💬 | wokay + flambeau |
| `A3` | `idpHint` — wokay expects it honoured, flambeau deliberately ignores it | 💬 | flambeau |
| `A4` | `DOWNLOAD_NOT_PERMITTED` — 403 or 422 | 💬 harmless to us; we branch on `code`, never on status | flambeau |
| `A5` | Does flambeau's app token carry `aud: tf-app`? Is there a third `tf-refresh` audience? | 💬 **blocks all auth** — until it's yes, no app token passes wokay's filter chain | both |
| `A6` | `devicePublicKey` — "Base64 SPKI DER" vs "base64 of raw bytes" | ✅ **our side is right**; comment in `reading-session.ts` now says so explicitly. Do not "fix" the encoding to match flambeau's prose | flambeau to reword |
| `A7` | `Encryption.keyId` optionality; truncated example hides `keyFingerprint` | ✅ **our side aligned** — `keyId` relaxed to optional in `content-provider.ts` | flambeau to publish the full example |
| `A8` | `wantSearchIndex` default — wokay says `true`, flambeau says nothing | ✅ **comment corrected**; behaviour never depended on it (we always send it explicitly) | flambeau to state it |
| `A9` | Does borrowing `OPEN_ACCESS` write a loan? flambeau's table and prose disagree | 💬 `downloadManager.ts` borrows unconditionally and reads `canPersist`/`dueAt` off the result — works under the prose reading, breaks under the table reading | flambeau |
| `A10` | `/api/v1/loans/changes` or `/api/v1/changes`? | 💬 **still undecided.** `B6`'s Sync half shipped anyway, with the path isolated in one constant (`LOAN_CHANGES_PATH`, `syncConfig.ts`) so the move is a one-line change rather than a search-and-replace. Deciding is still cheaper than not | flambeau |

### Register B — contracts vs. this app

| # | Finding | Status | Owner | Detail |
| --- | --- | --- | --- | --- |
| `B1` | 🔴 No `Authorization` header, no token, no auth flow at all | ❌ | Abhinav + CAP-6 | `download/` |
| `B2` | 🔴 Base URL is an untracked mock on `:4000`, not `:8080` | ❌ | Abhinav | `download/` |
| `B3` | 🔴 `keyFingerprint` never compared to the device key | ✅ **closed by `84f2476`** — but see `C7` above | Abhinav | `encryption/` |
| `B4` | 🔴 `SignedLicence` exists in no contract; synthesized with an empty signature | ❌ **contract comment corrected so it no longer claims a guarantee we don't have**; the type itself still needs a Gate decision | Ahana + Abhinav | this file's §B4 below |
| `B5` | 🟠 Loans borrowed, never returned; no holds/library/availability | ❌ | CAP-4 boundary | `download/` |
| `B6` | 🟠 Change feed unimplemented — the designed revocation channel | 🟡 **Sync half implemented**: `sync/loanChanges.ts` + `sync/offlineLock.ts` consume the feed, persist a cursor, and emit `content.lock`/`content.unlock`. Encryption's subscriber (destroy the BEK on `reason: 'revoked'`) is **not** written — that half is Abhinav's | Abhinav/Karthik | `download/`, `sync/` |
| `B7` | 🟠 Per-open check fails open; safe only once `B6` lands | 🟡 **hardened and widened** by `84f2476` (keychain failures now fail open too, correctly) — the accepted-risk record still does not exist | Abhinav | `download/` |
| `B8` | 🟠 `POST /device/register-key` doesn't exist; flambeau rejects the concept | ❌ | Abhinav + Ahana (barrel) | `download/` |
| `B9` | 🟡 `AccessTier` was a fourth tier spelling | ✅ **now an alias for `LicenceModel`** (`tier.ts`). Full deletion is still a Gate item | Ahana | done here |
| `B10` | 🟡 `INVALID_DEVICE_PUBLIC_KEY` in no contract; auth codes unmapped | 🟡 **documented** in `reading-session.ts`; the mapping work is open | Abhinav | `download/` |
| `B11` | 🟡 25 MB client ceiling, no contract bound | ❌ | wokay question | `encryption/` |
| `B12` | 🟡 `format` hardcoded `'EPUB'` | 🟡 **blocked on `C3`, now documented as blocked** at `readerAssets.ts` | blocked | Reader |
| `B13` | 🟢 `reachableAssetUrl` port rewrite, hazardous after `B2` | ❌ | Abhinav | `download/` |
| `B14` | 🟢 Wrong `wantSearchIndex` default in a comment | ✅ **fixed** | Ahana | done here |
| `B15` | 🟢 Subscription audio would persist with no licence or expiry | ❌ | Abhinav | `download/` |
| `B16` | 🟢 Dangling `flambeau-contract-comparison.md` citations ×4 | 🟡 **2 of 4 repointed** (both in this directory); 2 remain in `download/` | Abhinav for the rest | — |

### Register C — gaps

| # | Gap | Status | Owner |
| --- | --- | --- | --- |
| `C1` | Sync client claims unallocated `/api/v1/**` subtrees; tracked backend serves `/api/*` | ❌ | Karthik |
| `C2` | No contract covers CAP-7's sync surface at all | ❌ | CAP-7 to publish one |
| `C3` | No catalogue/discovery/institution client — **unowned**, blocks `B12` and step 1 of `B1` | ❌ | needs an owner |
| `C4` | `items:batch` 100-id cap interacts with `GET /library`'s non-pagination | ❌ | whoever builds the shelf |
| `C5` | `availability` endpoint has a documented consumer, no implementation | ❌ | flambeau |
| `C6` | 🔴 **No contract says how the app receives its token after the SAML browser round trip** | 💬 **highest-value open question in the whole review** — `B1` cannot be built until it is answered | flambeau |
| `C7` | `keyFingerprint` digest input/length unspecified | 💬 **now blocking** — see the top of this file | wokay |
| `C8` | Untracked artefacts referenced by tracked code | 🟡 the review doc itself is now committed; `mock-backend/` still is not | Abhinav |

---

## What `84f2476` actually changed, and what it introduced

Recorded because the commit did three good things nobody asked for, and created two problems the
review doc predates.

**Closed or improved:** `B3` (fully), `B7` (hardened), `A7`/`A8` YAML verification for
`SignedUrl`/`IndexUrl`.

**Beyond the review doc, all correct:**

- **ELITE double-accounting.** A STREAM-only read was writing a `COMPLETED` downloads row and
  burning one of the five offline slots for a book that was never persisted. Five ELITE reads and
  zero real downloads would have hit a bogus `BOOK_LIMIT_REACHED`.
- **Fetch timeouts** on all four network calls — 8s for metadata, a deliberately separate 60s for
  the asset body, because React Native's `fetch` resolves only once the whole body has arrived, so
  one shared timer would have capped a legitimate 25 MB download at >3 MB/s.
- **Absent-field handling** for `originalLength`/`mimeType`, which previously would have rejected
  every download with a `CHECKSUM_MISMATCH` blaming a field the response never carried.

**Introduced:**

1. **`C7` became a blocker** — see the top of this file.
2. **`FORMAT_MIME_TYPES` added an `AUDIO` row while `B15` is unfixed**, so the audio path now reads
   as more supported than it is. A subscription audiobook still persists forever with no licence
   and no expiry.

---

## §B4 — the decision this directory owns

`SignedLicence` (`content-provider.ts`) describes a wire object **no documented endpoint returns**.
wokay's `ContentGrant` is exactly `content` / `index` / `encryption`; flambeau's
`ReadingSessionResponse` adds only session fields. Neither carries a licence, a signature, or print
rights. `downloadManager.ts` synthesizes one per download so `contentStore.store()` has the
Subscription-vs-Elite signal it is built around.

What that costs:

- The RS256 trust path is decorative. `signature.value` is `''` and nothing verifies it, so
  `ContentError.LICENCE_INVALID` can never fire for a signature.
- `rights: { print: false }` is fabricated. Anything gating on it gates on a client-side constant.
- The open-access sentinel `'9999-12-31T23:59:59.000Z'` means a bug that mis-tags a subscription
  book as open access grants a **perpetual** offline licence. A nullable `expiresAt` would fail
  closed instead.
- `expiresAt` is the one field doing real work, and it is sourced correctly from `loan.dueAt`.
  Keep that.

**The question for the Gate: does a signed licence exist in this system?**

- **Yes** → flambeau/wokay add it to `ContentGrant`/`ReadingSessionResponse`, publish signing-key
  distribution, and we wire up RS256 verification.
- **No** → rename to `LocalLicenceRecord`, move it out of `shared/contracts/` (a device-side record
  is not an inter-team wire contract), and delete `signature` rather than filling it with a
  placeholder.

**Recommendation: no.** Both contracts have converged on GCM's authentication tag plus a
short-lived signed URL as the integrity and authorisation mechanism. A second RS256 licence layer
is in neither document and nobody is building the signer. Say so explicitly rather than leaving a
frozen contract asserting a guarantee that does not exist.

Until it is ruled on, the type stays and the comments tell the truth about it. Both halves matter.

---

## Verified correct — do not "fix" these

They look like divergences until you check the contract. A sweep for conflicts will trip over all
six.

| # | Thing | Why it's right |
| --- | --- | --- |
| `B_ok1` | `publicKeyToRawBase64()` strips PEM armour → 392 chars for RSA-2048 | That **is** base64 SPKI DER, exactly what wokay specifies. Change flambeau's wording, not this |
| `B_ok2` | Offline licence expiry comes from `loan.dueAt`, never `ReadingSessionResponse.expiresAt` | The subtlest thing in the two contracts. Conflating them would expire every offline book five minutes after download |
| `B_ok3` | `intent: loan.canPersist ? 'DOWNLOAD' : 'STREAM'` | Hardcoding `'DOWNLOAD'` would make every ELITE title fail `403 DOWNLOAD_NOT_PERMITTED` |
| `B_ok4` | No checksum; a ciphertext-length cross-check instead | `ReadingSessionResponse` carries no checksum. GCM's tag is the integrity mechanism. The length check matches wokay's "exactly 12 + plaintext + 16" |
| `B_ok5` | `SignedUrl`/`IndexUrl` mirror wokay field-for-field, including unread `termCount` | Dropping a field silently diverges from the contract |
| `B_ok6` | An index fetch failure does not fail the book | Nothing in either contract requires an index for a book to be readable |

---

## Per-capability detail

Each capability owns its own list. **Read yours before touching contract-facing code in your
directory**, and update it in the same change that closes an item.

| Capability | Doc | Owner |
| --- | --- | --- |
| Download | `src/features/download/API_CONTRACT_NOTES.md` | Abhinav |
| Encryption | `src/features/encryption/API_CONTRACT_NOTES.md` | Abhinav |
| Sync | `src/features/sync/API_CONTRACT_NOTES.md` | Karthik |
| Search | `src/features/search/API_CONTRACT_NOTES.md` | Vaishnavi |
| Personalization | `src/features/personalization/API_CONTRACT_NOTES.md` | Vaishnavi |
| Accessibility | `src/features/accessibility/API_CONTRACT_NOTES.md` | Hruthik |
| Reader + contracts | this file | Ahana |

---

## Rules for changing anything in this directory

`src/shared/contracts/` is the Week-1 freeze — the interface between seven capabilities owned by
five people. `__typecheck__.ts` is the canary, and it is in `.prettierignore` deliberately
(`@ts-expect-error` is line-positional).

1. **If the canary goes red, a freeze broke.** Find out why. Do not "fix" the canary.
2. **Relaxing a field to optional to match a published spec is not a freeze break** — it is the
   freeze doing its job, because the frozen type was wrong about the wire. Add the pin to
   `__typecheck__.ts` in the same change, the way `84f2476` did for `SignedUrl`.
3. **Removing or renaming an exported type IS a freeze break.** That is a Gate conversation
   (`B4`, `B8`, the full `B9` deletion), not a quiet edit.
4. Import via the `index.ts` barrel, never deep paths.
5. When you close a finding, strike it here **and** in the capability doc. A ledger that lags the
   code is worse than no ledger.
