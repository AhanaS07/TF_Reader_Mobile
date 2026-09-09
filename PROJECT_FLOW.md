# TF Reader Mobile — how the whole project actually flows

Snapshot of `dev_T4` on 2026-08-18. This traces **actual code paths, with `file:line`
references** — not the intended architecture. Where something is designed but not yet
wired up, that's called out explicitly, because a surprising amount of this codebase is
exactly that: a fully-built, fully-tested capability sitting one import away from being
live.

**Read this first — the single most important fact about this codebase:**

There is no navigator and no library screen yet (`src/navigation/` is a `.gitkeep`). So
`App.tsx` mounts `ReaderScreen` directly against a hardcoded dev fixture. Two whole
capabilities that are fully built and fully tested — **Sync** (`syncEngine.run()`) and
**Download** (`downloadBook()`) — have **zero live call sites** in the app. Nothing
outside their own test files ever calls them. The reader you can actually run today gets
its book from `devContentSeed.ts`, a dev-only stand-in that calls `contentStore.store()`
directly, skipping Download entirely.

---

## Contents

1. [App boot](#1-app-boot)
2. [The flagship flow: opening and reading a book](#2-the-flagship-flow-opening-and-reading-a-book)
3. [Download: acquiring a book (built, not yet live)](#3-download-acquiring-a-book-built-not-yet-live)
4. [Encryption: what's actually inside ContentStore](#4-encryption-whats-actually-inside-contentstore)
5. [Sync: push/pull and offline-lock (built, not yet live)](#5-sync-pushpull-and-offline-lock-built-not-yet-live)
6. [Personalization: prefs store and live subscription](#6-personalization-prefs-store-and-live-subscription)
7. [Accessibility: TTS and EPUB metadata (built, not yet live)](#7-accessibility-tts-and-epub-metadata-built-not-yet-live)
8. [Search: in-book only](#8-search-in-book-only)
9. [Cross-cutting: contracts, event bus, ownership](#9-cross-cutting-contracts-event-bus-ownership)
10. [What's live vs. built-but-disconnected — the full ledger](#10-whats-live-vs-built-but-disconnected--the-full-ledger)

---

## 1. App boot

```
index.js:3  import App from './App'
index.js:6  registerRootComponent(App)          — Expo's RN root registration
App.tsx:58  export default function App()
```

- `App.tsx:62` — `useState<BookId>(DEV_SAMPLE_BOOK_ID)`. `DEV_SAMPLE_BOOK_ID` is resolved
  **at module load** in `devContentSeed.ts:107-112`:
  ```
  FIXTURE_PATH set?        → DEV_FIXTURE_EPUB_BOOK_ID   (large EPUB pushed into container)
  EXPO_PUBLIC_READER_FORMAT === 'PDF' → DEV_SAMPLE_PDF_BOOK_ID
  else                      → DEV_SAMPLE_EPUB_BOOK_ID
  ```
- `App.tsx:102` renders `<ReaderScreen key={bookId} bookId={bookId} />` inside
  `<SafeAreaProvider><SafeAreaView>`. **No `ensureSeeded()` call here** — that happens
  inside `ReaderScreen`'s own effect (§2).
- The EPUB/PDF toggle pills (`App.tsx:76-93`) are a **format picker standing in for a
  book picker** — `Pressable.onPress` → `setBookId(fixture.bookId)` → `ReaderScreen`
  remounts (it's `key`ed on `bookId`) with the other fixture id. `ReaderScreen` never
  receives a format prop; it reads the format back from the stored package itself
  (`getFormat`, §2) — switching pickers exercises the *same* code path a real library
  screen eventually will.

---

## 2. The flagship flow: opening and reading a book

This is the one true end-to-end path that runs live today, exercised via the dev
fixtures. Every arrow below is a real call, in order.

### 2a. Format/shell resolution

`ReaderScreen.tsx:284-326`, effect keyed on `[bookId, raiseError]`:

```
prepareBook(bookId)                              readerAssets.ts:121
 └─ ensureSeeded(bookId)                          devContentSeed.ts:295
     no-op if isAvailableOffline(bookId) && seedVersionOnDisk(bookId) === SEED_VERSION
     else:
       contentStore.destroy(bookId)               contentStore.ts:590
       buildPackage(bookId, await sampleBookBytes(bookId))   devContentSeed.ts
         ├─ generateDeviceKeypair()                deviceKeypair.ts:104
         ├─ encrypt(bytes, bek)                     aesGcm.ts:45
         └─ wrapBek(bek, publicKey)                 deviceKeypair.ts:200
       contentStore.store(pkg)                      contentStore.ts:223
       writes dev-seed-<bookId>.version marker file
 └─ getFormat(bookId)                              contentProvider.ts:71
     └─ contentStore.openSession(bookId)            contentStore.ts:306   (metadata only, no decrypt)
     → returns 'EPUB' | 'PDF' | 'AUDIO'

getReaderHtmlUri(bookFormat)                        readerAssets.ts:77
 └─ READER_HTML_MODULES[format]                     readerAssets.ts:42-45
     static require() of assets/reader/reader-epub.html / reader-pdf.html
     'AUDIO' → throws UnsupportedFormatError
 └─ localUriFor(assetModule, label)                 readerAssets.ts:56
     Asset.fromModule(assetModule).downloadAsync() → file:// URI

setResolved({ bookId, format, htmlUri })            ReaderScreen.tsx:297
 → mounts <ReaderWebView> keyed on the shell URI     ReaderScreen.tsx:574
```

Failure paths: `UnsupportedFormatError` → `raiseError('UNSUPPORTED_FORMAT', …)`; anything
else → `raiseError('ASSET_LOAD_FAILED', …)`.

### 2b. WebView boots, handshakes `ready`

```
ReaderWebView.tsx:51    <WebView source={{uri: sourceUri}} onMessage={handleMessage}>
```

Inside the loaded HTML (`assets/reader/reader-epub.html` / `reader-pdf.html`, generated
by `buildReaderHtml.ts` from the templates + `reader.bridge.html` fragment): the IIFE
runs on load, defines `window.TFReader = { openEpub/openPdf, next, prev, goTo }`, then:

```
post({ type: 'ready' })    →  window.ReactNativeWebView.postMessage(JSON.stringify(...))
```

Back on the RN side:

```
ReaderWebView.handleMessage(raw)                    ReaderWebView.tsx:108-132
 └─ parseReaderMessage(raw)                          readerBridge.ts:404
     type === 'ready' → setIsReady(true); onReadyRef.current(send)
       send = webViewRef.current.injectJavaScript(buildCommandScript(command))   ReaderWebView.tsx:77
```

`onReady` prop is `ReaderScreen.handleReady` (`ReaderScreen.tsx:362`) — this is where the
book's actual bytes get fetched and pushed in.

### 2c. `handleReady` — the Download ⇄ Encryption ⇄ Bridge handoff

```
handleReady(sender)                                 ReaderScreen.tsx:362
 1. setSend(() => sender); logEvent('ready')
 2. withOpenTimeout(getBookBase64(bookId, format))   ReaderScreen.tsx:378  (OPEN_TIMEOUT_MS ceiling)
 3. getBookBase64(bookId, format)                    readerAssets.ts:195
     a. verifyReadingAccess(bookId, format)          readingSessionClient.ts:199   ← DOWNLOAD
         generateDeviceKeypair()                     deviceKeypair.ts:104
         openReadingSession(bookId, {format, intent:'STREAM', devicePublicKey, wantSearchIndex:false})
                                                      readingSessionClient.ts:125
           POST /api/v1/reading-sessions
         FAILS OPEN except for FAIL_CLOSED_CODES     readingSessionClient.ts:174
     b. ensureSeeded(bookId) again                   readerAssets.ts:206   (fast no-op — already seeded in 2a)
     c. getBook(bookId)                              contentProvider.ts:61   ← ENCRYPTION (see §4 for internals)
         contentStore.openSession(bookId)            contentStore.ts:306
         contentStore.decryptBook(bookId)            contentStore.ts:371
           → resolveRawKey() → aesGcm.decrypt()/decryptBook()   aesGcm.ts:99,147
           → real AES-256-GCM plaintext Uint8Array
     d. fromByteArray(bytes)                         react-native-quick-base64 → base64 string
 4. switch (format):
      'EPUB' → sender({ type: 'openEpub', base64 })
      'PDF'  → sender({ type: 'openPdf',  base64 })
      'AUDIO'→ raiseError('UNSUPPORTED_FORMAT', …)   (unreachable today — no audio fixture)
 5. sender(command)                                  ReaderWebView.tsx:77
     webViewRef.current.injectJavaScript(buildCommandScript(command))   readerBridge.ts:463
     → injects: (function(){ try { window.TFReader.openEpub(base64) } catch(e){ post error } })(); true;
 6. Template side:
     EPUB: base64ToArrayBuffer (reader.bridge.html) → epub.js book.open(arrayBuffer) → rendition.display()
           → post({type:'rendered'}); book.loaded.navigation → flattened TOC → post({type:'toc', items})
     PDF:  same shape via pdf.js getDocument() → render first page → post({type:'rendered'})
           → getOutline() → post({type:'toc', items})
     Any caught error in either template/bridge → post({type:'error', code, message})
```

Failure paths back in `ReaderScreen`: timeout → `raiseError('CONTENT_LOAD_TIMEOUT', …)`;
a thrown `ContentFailure`/`DownloadFailure` → `raiseError('CONTENT_LOAD_FAILED', …)` with
`.code` interpolated (`ReaderScreen.tsx:428-434`).

**Format never crosses the bridge as data** — the host picks the *command name*
(`openEpub` vs `openPdf`) in typechecked TS (`readerBridge.ts:340-353`); each template
only defines its own method. This is the frozen rule `readerBridge.test.ts` enforces (see
`CLAUDE.md`'s "Format routing does NOT cross this bridge" and `WEBVIEW_BRIDGE.md`).

### 2d. Messages back from the WebView

`ReaderScreen.handleMessage` (`ReaderScreen.tsx:443-472`):

| `type` | What happens |
|---|---|
| `ready` | no-op here (already handled by `onReady`/`handleReady` above) |
| `rendered` | `logSpan('open -> rendered', …)`; `setIsRendered(true)` |
| `relocated` | carries `{cfi, atStart, atEnd}`; **currently unconsumed** — comment marks it as belonging to a future Personalization "reading progress" record |
| `toc` | `setToc(message.items)` |
| `error` | `logSpan('open -> error', …)`; `setError({code, message})` |

### 2e. User-driven navigation

```
goTo(target)             ReaderScreen.tsx:477   → send?.({type:'goTo', target})
Prev / Next toolbar       ReaderScreen.tsx ~700s → send?.({type:'prev'|'next'})
```
Same `buildCommandScript` → `injectJavaScript` path as opening. epub.js does
`rendition.display(cfi)`; pdf.js scrolls/paginates to the target page.

### 2f. Close / unmount

`ReaderScreen.tsx:340-352`, a **separate** effect keyed on `[bookId]` (fires on unmount
*and* whenever `bookId` changes — so switching books tears down the previous session
too):

```
closeBook(bookId)                    contentProvider.ts:78
 └─ contentStore.close(bookId)       contentStore.ts:575
     zeroes session.plaintext / indexPlaintext / rawKey, deletes the session
     packageCache.delete(bookId)     ← added 2026-08-18, see CLAUDE.md
```
Fire-and-forget; errors swallowed (the screen is already gone).

---

## 3. Download: acquiring a book (built, not yet live)

**`downloadBook()` has zero call sites outside its own tests.** This is the "acquire a
NEW book" path — distinct from §2c's `verifyReadingAccess` (a per-open re-check of a book
already on the device). No UI anywhere triggers it.

```
downloadBook(bookId, format='EPUB')                 downloadManager.ts:154
 1. checkStoragePermission()                         permissions.ts   (always true — named seam, no real OS permission needed)
 2. checkAvailableStorage()                          storageCheck.ts   (Paths.availableDiskSpace >= 100MB floor)
 3. borrowLoan(bookId)                                readingSessionClient.ts:82
     POST /api/v1/loans  → { licenceModel, canPersist, dueAt, loanId }
 4. if loan.canPersist: assertBookLimitNotExceeded(bookId, downloadTable.listActive(USER_ID))   (5-book cap, pre-check)
 5. generateDeviceKeypair() → publicKeyToRawBase64() → publicKeyFingerprint()   deviceKeypair.ts
 6. openReadingSession(bookId, {format, intent: loan.canPersist?'DOWNLOAD':'STREAM', devicePublicKey, wantSearchIndex:true})
                                                       readingSessionClient.ts:125
     POST /api/v1/reading-sessions → { content:{url,mimeType,originalLength,...}, encryption, index? }
 7. anti-key-substitution check: session.encryption.keyFingerprint === deviceKeyFingerprint   (else KEY_SUBSTITUTION)
 8. fetchEncryptedAssetChunked(bookId, session.content.url, {maxBytes})   chunkedAssetFetcher.ts:150
     1 MiB Range-header chunks, resumable via a disk-persisted manifest, budget-checked as soon as
     total length is known
 9. cross-check computeOriginalLength(bytes.length, isEncrypted) against session.content.originalLength
10. reject BOOK_TOO_LARGE if originalLength > MAX_DECRYPTED_BYTES  (before store — nothing persisted yet)
11. if session.index?.url: fetchEncryptedAsset(bookId, url)   contentLicenceClient.ts:95   (failure-tolerant — logged, not fatal)
12. build EncryptedPackage (bookId, format, content, index, encryption, licence, cipherLength, originalLength, mimeType)
13. contentStore.store(pkg)                           contentStore.ts:223   ← hands off to Encryption (§4)
14. if !loan.canPersist (ELITE): return — nothing written to the downloads table, nothing to roll back
15. else, under withWriteLock:                        syncableTable.ts:88
      re-query downloadTable.listActive(USER_ID), re-assert the 5-book cap
        (loses the race → contentStore.destroy(bookId) rollback, rethrow original error)
      downloadTable.saveLocal(row, existing?'UPDATE':'CREATE', {locked:true})
```

Everything here is real and tested (76 unit tests + a real end-to-end integration test
against a live mock backend, `downloadManager.integration.test.ts`) — it's simply never
invoked by the running app, because there's no download button anywhere yet.

---

## 4. Encryption: what's actually inside ContentStore

`contentStore.ts` is the frozen `ContentStore` implementation. Two module-level maps hold
all state: `packageCache: Map<BookId, EncryptedPackage>` and `sessions: Map<BookId,
OpenSession>`.

```
store(pkg)                             contentStore.ts:223
 assertLengthInvariant(pkg); assertLicenceMatchesPackage(pkg)
 if !isElite(pkg): invalidateStaleCachedKeyIfRotated(pkg)   — clears cached BEK if wrappedBek rotated
 packageCache.set(pkg.bookId, pkg)
 if isElite(pkg): return                — in-memory ONLY, nothing written to disk
 else: writeFile(contentFile), writeFile(indexFile)?, writeFile(metaFile)   — ciphertext + licence persist

openSession(bookId)                    contentStore.ts:306
 if session exists: return its handle (idempotent)
 pkg = packageCache.get(bookId) ?? loadPersisted(bookId)     — cold read: contentFile(bookId).bytesSync(), SYNCHRONOUS
 packageCache.set(bookId, pkg)          — lazily repopulate cache on a cold start
 sessions.set(bookId, newSession); returns {bookId, format, openedAt}

decryptBook(bookId)                    contentStore.ts:371
 session must exist (from openSession); returns session.plaintext if already decrypted
 shares one in-flight promise if a decrypt is already running (session.pending)
 assertLengthInvariant(pkg); isLicenceExpired(pkg) check; MAX_DECRYPTED_BYTES check
 if !pkg.encryption: plaintext = COPY of pkg.content   (open access / audio)
 else:
   rawKey = resolveRawKey(pkg, session)   contentStore.ts:332
     session.rawKey cached?              → use it
     Elite?                              → NEVER touches keychain — unwrapBek() only, kept in-memory (session.rawKey)
     else: getBek(bookId) cached in keychain?  → use it
     else: unwrapBek(pkg.encryption.wrappedBek)   deviceKeypair.ts:219 (real RSA-OAEP-256)
           → storeBek(bookId, rawKey)     keyStorage.ts:35   (cache for next session)
   plaintext = decrypt({content, cipherLength, originalLength}, rawKey)   aesGcm.ts:147
     → decryptBook(ciphertextWithTag, nonce, key)   aesGcm.ts:99
       createDecipheriv('aes-256-gcm', key, nonce) → setAuthTag → update → final
       (native react-native-quick-crypto, bytes in/out, no base64 hop — see §10 history)
 session.plaintext = plaintext; returned

close(bookId)                          contentStore.ts:575
 zero session.plaintext/indexPlaintext/rawKey; sessions.delete(bookId); packageCache.delete(bookId)

destroy(bookId)                        contentStore.ts:590
 close(bookId) → delete contentFile/indexFile/metaFile from disk → deleteBek(bookId) → packageCache.delete(bookId)
 TERMINAL — the only way back in is a fresh store()
```

`getIndex`/`decryptSearchIndex` (`contentStore.ts:477`) is an **independent** decrypt pass
— a corrupted/tampered search index rejects on its own without touching `decryptBook`'s
session state (Search's failures don't make the book unreadable).

---

## 5. Sync: push/pull and offline-lock (built, not yet live)

**`syncEngine.run()` has zero production call sites.** `useConnectivity()`
(`useConnectivity.ts:18`), meant to decide when to auto-sync per its own doc comment, is
also never called anywhere. Only test files (`syncEngine.test.ts`,
`syncEngine.integration.test.ts`) ever run this. There is no timer, no app-foreground
hook, no manual "sync now" button.

```
syncEngine.run()                        syncEngine.ts:75
 └─ execute()                           syncEngine.ts:100   (deduped via module-level `inFlight` promise)
     1. push(report)                    syncEngine.ts:137
     2. pull(report)                    syncEngine.ts:322
     3. report.entitlement = await checkEntitlements()   syncEngine.ts:123
        ← OUTSIDE the try/catch: always runs even if push/pull threw

push():
 outboxStore.listPending()
 for each op:
   serverHasDiverged(op, entityPath)?          (skipped entirely if SERVER_RESOLVES_CONFLICTS)
   send(op, entityPath, payload)               syncEngine.ts:204
     → sendCreate/sendUpdate/sendDelete → api.create/update/remove   syncApi.ts
       fallback rules: create→update on 409, update→create on 404, delete→create-then-delete on 404
   success → outboxStore.remove([op.id]); TABLES[entityType].adoptPushResult(saved)/.markSynced()
 syncMetadataStore.set(SYNC_KEYS.LAST_PUSH_AT, nowIso())

pull():
 for each of the 6 syncable tables (progress, bookmarks, highlights, personalization, accessibility, downloads):
   api.list(ENTITY_PATHS[entityType], {userId, bookId, updatedAfter})
   for each record: table.applyServerRecord(record)          — Last-Write-Wins merge
 advance syncMetadataStore checkpoint only after all tables applied
 NOTE: bookId scope is hardcoded to the single BOOK_ID constant (syncConfig.ts) — multi-book
 sync is a documented prototype limitation, not implemented.

withWriteLock (syncableTable.ts:88):
 a single module-level promise-chain mutex serializes EVERY write across ALL six syncable
 tables (not per-table) — the one queue the app's single SQLite connection needs.
```

### Offline-lock (the loan-revocation feed)

```
checkEntitlements()                     offlineLock.ts:100
 loop up to MAX_LOAN_CHANGE_PAGES (10):
   fetchLoanChanges(cursor)              loanChanges.ts
   for each entry:
     applyEntry(entry, report)           offlineLock.ts:143
       isRevoking(entry) → downloadStore.setValidity(bookId, false); eventBus.emit(OFFLINE_LOCK_EVENTS.LOCK, signal)
       isRestoring(entry) → setValidity(bookId, true); eventBus.emit(OFFLINE_LOCK_EVENTS.UNLOCK, signal)
 FAILS OPEN: offline / timeout / unparseable body → emits nothing, advances nothing, every book
 stays exactly as valid as it already was (deliberate — see the file's own header).
```

**This does NOT call into Encryption to destroy anything.** It only flips a
`downloads.is_valid` column and emits an event on the shared bus (`src/shared/eventBus.ts`
— lives outside both features specifically so neither imports the other). **Confirmed by
grep: nothing in the entire repo subscribes to `OFFLINE_LOCK_EVENTS`.** It's a broadcast
into the void — exactly what CLAUDE.md flags as "Encryption's BEK-destroy-on-revoke
subscriber is not written."

`localDb/database.ts`: `getDatabase()` is a cached singleton promise — first call does
`SQLite.openDatabaseAsync('reader-offline.db')` → `execAsync(SCHEMA_SQL)` →
`runMigrations(db)` (checks `PRAGMA table_info` to add columns idempotently).

---

## 6. Personalization: prefs store and live subscription

Storage is **two separate SQLite rows** (`personalization`, `accessibility` tables), not
one — so independent Last-Write-Wins resolution can't let an edit to one clobber the
other's `updatedAt`.

```
sharedPrefs.ts:  readSharedPrefs() / writeSharedPrefs() / resetSharedPrefs()
  merge the two rows into one SharedPrefs object (frozen shape) and split writes back onto
  the two tables (personalizationStore.ts / accessibilityStore.ts — both createSyncableTable
  instances, so a save is queued into the SAME outbox syncEngine.push() drains, §5 — same
  sync path, not a separate one).

prefsStore.ts (Personalization's own wrapper):
  getPrefs()          → readSharedPrefs()
  savePrefs(patch)     → read current → writeSharedPrefs({...current, ...patch}) → re-read → notify(fresh)
  resetPrefs()         → resetSharedPrefs() → re-read → notify(fresh)

Live subscription (commit 7bf0196) — NOT the event bus:
  a plain module-level Set<PrefsListener> in prefsStore.ts
  subscribe(listener) → adds to the set, returns an unsubscribe closure
  notify(prefs) (private) → iterates the set, swallows listener exceptions
  Fires ONLY from savePrefs/resetPrefs. A prefs row arriving via Sync's pull() does NOT
  go through this and does NOT notify — an explicitly flagged gap in the code's own comment.

event-bus.ts DOES define PrefsChangedEvent / EVENT_CHANNELS.PREFS_CHANGED, but it's dead —
its own comment says "Reader subscribes to the prefs store instead," and prefsStore.ts
confirms the event-bus follow-up "is gone."

readerAppearance.ts:
  toReaderAppearance(prefs, env) resolves a full SharedPrefs + AppearanceEnv (OS color
  scheme / font-scale / reduce-motion) into a flat ReaderAppearance primitive object
  (theme colors, font, typography, layout, zoom, a11y flags) via resolveTheme() /
  resolveFont() / composeFontSizePt().
```

**Not wired to Reader yet.** `toReaderAppearance`/`ReaderAppearance` appears in exactly
one place under `src/features/reader/`: a doc comment in `readerBridge.ts:106-125`
describing the **signed-off but unbuilt** `applyAppearance(ReaderAppearance)` command
(must fire before `openEpub`/`openPdf`, per both templates). `prefsStore.subscribe()` has
**zero callers anywhere in the app**. Per `CLAUDE.md`, this is gated on the
typechecked-WebView bridge conversion, which is now the next task in `reader/`.

---

## 7. Accessibility: TTS and EPUB metadata (built, not yet live)

Two independent sub-areas, both fully built and tested, **neither wired into
`ReaderScreen`**:

**TTS** (`src/features/accessibility/tts/`): `TtsControls.tsx`, `VoicePicker.tsx`,
`useTtsSession.ts`, `useTtsEnabled.ts`, `ttsEngine.ts`, `ttsRate.ts`. Grep confirms
`TtsControls` is imported nowhere outside its own directory — it is not mounted by
`ReaderScreen.tsx` or anywhere else. It's built against
`src/features/reader/tts/readerTextProvider.ts` (the permanent, agreed interface) via
`fakeReaderTextProvider.ts` (a temporary stand-in with synthetic CFIs that resolve
against no real book — see `TTS_PROVIDER.md`). The real provider is blocked behind the
same typechecked-WebView conversion as `applyAppearance` (§6) — `readerBridge.ts:127-135`
documents it as the "second candidate," a `requestSentence` request/reply the bridge
doesn't support yet.

**EPUB accessibility metadata** (`getPublicationAccessibility.ts`,
`parseOpfAccessibility.ts`, `readEpubA11yMetadata.ts`, `publicationA11ySummary.ts`):
parses OPF/schema.org accessibility metadata (access modes, features, hazards) out of an
EPUB's container. `getPublicationAccessibility()` has **zero callers outside its own
test** — nothing in the reader or anywhere else currently asks a book for its
accessibility summary.

---

## 8. Search: in-book only

The one Reader-adjacent capability that IS fully live:

```
ReaderScreen search toolbar button      ReaderScreen.tsx:543-561
 → setShowSearch(true) → renders <SearchPanel>, bound to useBookSearch(bookId)   useBookSearch.ts:107

SearchPanel submit → search.submit()    useBookSearch.ts:172
 increments requestSeqRef, status:'searching'
 queryBookIndex(bookId, term)           @/features/search/queryBookIndex.ts:19
 → SearchHit[] → setHits, status:'done'  (mountedRef/requestSeqRef guard drops stale responses)

selectHit(index)                        ReaderScreen.tsx:495
 cfiOf(hit)                              useBookSearch.ts:56   (EPUB → hit.locator.cfi; PDF → null, non-navigable)
 non-null → setActiveIndex(index); setShowSearch(false); send?.({type:'goTo', target: cfi})
   → SAME bridge path as TOC navigation (§2e)

stepHit(delta)                          ReaderScreen.tsx:508
 walks search.hits from activeIndex, skips non-navigable (PDF) hits, calls selectHit on
 the first navigable one; disabled-state via hasNavigableFrom (useBookSearch.ts:71)
```

Search never touches the WebView bridge directly — only through `ReaderScreen`'s existing
`goTo` command.

**Catalogue/discovery search does not exist in this repo at all** — grepped for `OPDS`,
`items:batch`, an institution picker, "catalogue": every hit is a doc-comment reference to
the *concept* (the unowned `C3` gap in `CONTRACT_ALIGNMENT.md`), never an implementation.

---

## 9. Cross-cutting: contracts, event bus, ownership

**`src/shared/contracts/`** — the Week-1 type freeze, imported only via the `index.ts`
barrel. Runtime-emitting members (the rest is types-only, erased at compile time):
`ContentError`/`ContentFailure` (errors.ts), `DEFAULT_PREFS` (prefs.ts),
`OFFLINE_LOCK_EVENTS`/`EVENT_CHANNELS` (offline-lock.ts/event-bus.ts), accessibility
default-prefs helpers, and the prefs-row adapter (`toPersonalizationRow` /
`fromPersonalizationRow` / `migrateSharedPrefs`). `__typecheck__.ts` is the canary — if it
goes red, a freeze broke.

**`src/shared/eventBus.ts`** — the one cross-capability event bus instance, deliberately
placed outside both Sync and Encryption so neither imports the other. Handlers are stored
per-channel in an **array, not a Set** (the same callback subscribed twice = two real
subscriptions). A throwing handler is caught and logged — delivery continues to the rest.
**Currently has exactly one publisher** (`offlineLock.ts`, §5) **and zero subscribers**
anywhere in the app.

**Ownership** (who to loop in before touching each area — see `CLAUDE.md` for the full
table):

| Area | Owner |
|---|---|
| `src/features/reader/` | Ahana |
| `src/features/download/`, `src/features/encryption/` | Abhinav |
| `src/features/sync/` | Karthik |
| `src/features/personalization/`, `src/features/search/` (in-book only) | Vaishnavi |
| `src/features/accessibility/` | Hruthik |
| `src/shared/`, `samples/` | Ahana (lead) |

`src/access`, `src/adapters`, `src/components`, `src/config`, `src/gallery`, `src/hooks`,
`src/model`, `src/navigation`, `src/screens`, `src/search`, `src/storage`, `src/store`,
`src/theme`, `src/utils` are all still `.gitkeep` — reserved structure, nothing built
there yet.

---

## 10. What's live vs. built-but-disconnected — the full ledger

| Capability | Status | Evidence |
|---|---|---|
| Reader: open + read a book (EPUB & PDF) | **LIVE** | `App.tsx` → `ReaderScreen` runs this today |
| In-book search | **LIVE** | Wired into `ReaderScreen`'s toolbar |
| `devContentSeed.ts` (dev fixture seeding) | **LIVE** (temporary) | Only thing currently feeding `contentStore.store()` |
| `verifyReadingAccess` (per-open re-check) | **LIVE** | Called every book open, fails open |
| Encryption (`ContentStore`, `aesGcm.ts`, `deviceKeypair.ts`) | **LIVE** | Exercised by every book open, real crypto |
| `downloadBook()` (Download's main entry point) | **Built, tested, NOT called live** | Zero non-test call sites |
| `syncEngine.run()` (push/pull) | **Built, tested, NOT called live** | Zero non-test call sites; no timer/hook triggers it |
| `checkEntitlements()` / offline-lock | **Built, tested, NOT called live** | Only reachable via `syncEngine.execute()`, which itself isn't called live |
| Offline-lock → Encryption revocation | **Not built** | Event emitted, nothing subscribes |
| Personalization prefs store + live subscription | **Built, tested, NOT wired to Reader** | `subscribe()` has zero callers |
| `applyAppearance` WebView command | **Designed, signed off, NOT built** | Blocked on the typechecked-WebView conversion |
| Accessibility TTS (`TtsControls`, session hook) | **Built, tested, NOT mounted anywhere** | `TtsControls` imported nowhere outside its own dir |
| EPUB accessibility metadata parsing | **Built, tested, NOT called live** | `getPublicationAccessibility()` has no callers |
| Catalogue/discovery search (OPDS) | **Does not exist** | Unowned gap (`C3`), doc-comment only |

The throughline: this is a set of independently-owned, independently-tested capabilities
built against frozen contracts, most of which are still waiting on the same two things to
go live — `RootNavigator` (to replace the dev-fixture wiring in `App.tsx`) and the
typechecked-WebView bridge conversion (to carry `applyAppearance` and TTS's
`requestSentence` across to the reader). Until those land, "run the app" and "exercise
every capability" are two different things.
