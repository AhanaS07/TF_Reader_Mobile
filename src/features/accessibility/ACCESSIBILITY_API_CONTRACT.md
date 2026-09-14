# Accessibility sync entity — published contract

**Owner: Hruthik.** Published in response to `CONTRACT_ALIGNMENT.md`'s `C2` finding: neither
wokay's nor flambeau's published contract covers CAP-7's sync surface at all, and CAP-7 has been
asking other teams to read our code to find out what an accessibility record looks like. This file
is that answer, kept in sync with `src/shared/contracts/accessibility.ts` (the frozen in-memory
type) and `src/features/sync/localDb/mappers.ts`'s `accessibilityMapper` (the actual wire mapping —
this file describes what that mapper produces and consumes, not a new shape invented for the
occasion).

**Status: describes the CURRENT behavior of a real, running client against the generic
`/api/v1/{entity}` CRUD backend** (`syncApi.ts`'s own header) — it is not a proposal for new
endpoints. `B1` (no auth token exists yet) and `C1` (this path isn't allocated in either external
team's `/api/v1/**` split) both still apply here exactly as `API_CONTRACT_NOTES.md` already
describes; this file doesn't change either.

## Endpoint

`entity = "accessibility"`, following the same generic pattern every other CAP-7 entity uses
(`syncApi.ts`):

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/api/v1/accessibility` | Create. `id` is device-minted and sent in the body. A second `POST` with the same `id` returns `409`. |
| `PUT` | `/api/v1/accessibility/{id}` | Update. Does **not** upsert — an unknown `id` returns `404`. |
| `DELETE` | `/api/v1/accessibility/{id}` | Without `?hard=true`, writes a tombstone (`isDeleted: true`) and returns it, rather than removing the record. |
| `GET` | `/api/v1/accessibility` (+ pull cursor) | Read, via the same pull mechanism every other entity uses — no accessibility-specific pull behavior. |

`updatedAt` is always overwritten with the server clock on write, regardless of what the client
sends. `createdAt` is stored as sent. `isDeleted` on a `POST` is ignored (creation can't create a
tombstone).

## Record shape (the exact JSON `accessibilityMapper.toServer` produces)

One record per user (`userId`) — not per device; see "Known limitation" below.

```jsonc
{
  "id": "string",
  "userId": "string",

  // Text/typography
  "dyslexiaFont": false,          // boolean
  "respectOsFontScale": true,     // boolean
  "boldText": false,              // boolean
  "fontScaleMultiplier": 1.0,     // number

  // Display
  "reduceMotion": "system",       // "system" | "on" | "off" — tri-state, see note below
  "readableSpacing": false,       // boolean
  "highContrast": false,          // boolean
  "largeTouchTargets": false,     // boolean
  "largeAudioControls": false,    // boolean

  // Text-to-speech
  "ttsEnabled": false,            // boolean
  "ttsVoiceId": null,             // string | null — platform voice identifier, opaque to the server
  "ttsRate": 1.0,                 // number — clamped client-side to [TTS_RATE_MIN, TTS_RATE_MAX]
  "ttsPitch": 1.0,                // number — clamped client-side to [TTS_PITCH_MIN, TTS_PITCH_MAX]
  "ttsHighlightMode": "sentence", // "none" | "word" | "sentence"
  "ttsAutoContinueChapter": true, // boolean
  "ttsBackgroundPlayback": false, // boolean

  // Navigation announcements
  "announcePageChanges": true,    // boolean
  "announceChapterChanges": true, // boolean

  // Native-control affordances only — see the field's own scoping note below
  "screenReaderHints": false,     // boolean

  // Sync bookkeeping — same shape every CAP-7 entity uses, not accessibility-specific
  "updatedAt": "2026-09-14T12:00:00.000Z", // ISO-8601 UTC string on the wire
  "isDeleted": false,
  "fieldUpdatedAt": { "ttsRate": "2026-09-14T11:58:02.000Z", "...": "..." } // per-field timestamps, for field-level merge — see fieldTimestamps.ts
}
```

**`reduceMotion` is tri-state, not boolean, and that's deliberate.** `'system'` means "defer to the
OS's live `AccessibilityInfo.isReduceMotionEnabled()` signal," resolved client-side per device —
see "Known limitation" below for why that resolution can't happen server-side.

**`screenReaderHints` reaches native RN controls only.** It has no effect on WebView/EPUB content —
that tree is built from the book's DOM and is unreachable from this preference. Any consumer of
this field outside this app must not infer "screen-reader-friendly" as a property of the book
content itself from this flag.

**Every field is independently mergeable.** `ACCESSIBILITY_MERGE_FIELDS`
(`accessibilityStore.ts`) lists all nineteen non-bookkeeping fields above as separately
last-write-wins-resolved via `fieldUpdatedAt`, not as one whole-record merge — a concurrent edit to
`ttsRate` on one device and `highContrast` on another does not let one silently overwrite the
other. This is why `fieldUpdatedAt` exists on the wire at all; a consumer that ignores it and does
whole-record LWW will reintroduce exactly the bug `accessibilityStore.ts`'s own header names as the
reason this record is split from Personalization's in the first place.

## Known limitation — flagged, not fixed by this file

**These eighteen preferences (everything except `id`/`userId`/bookkeeping) are synced
account-wide, not per-device**, per `API_CONTRACT_NOTES.md §4/§7`'s own standing decision (deferred
until real per-device identity exists — `B1` currently has one dev-token identity with no
per-device concept to attach a scope to). This matters most for `ttsVoiceId`/`ttsRate`/
`ttsHighlightMode` (properties of how someone uses a specific device, not of their library) and
`reduceMotion` (usually an OS-level property). A future per-device migration is expected to change
this record's shape — see the design note added to `API_CONTRACT_NOTES.md §7` for the field-level
approach already sketched for that, so implementing it later is a quick job, not a rediscovery.
