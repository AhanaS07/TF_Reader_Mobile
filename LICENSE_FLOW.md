# License, download & decrypt flow — what actually runs today, and what it's built to become

Scope: how a tap on a book row turns into decrypted pages on screen. Covers Download
(`src/features/download/`) and Encryption (`src/features/encryption/`), which own this flow, and
Reader (`src/features/reader/`) as the consumer at the far end. Written 2026-08-24, after fixing
the RSA-OAEP wrap bug (`B17`) and reclassifying the dev fixtures' tiers — see
`src/shared/contracts/CONTRACT_ALIGNMENT.md` for the live status of every numbered finding this
file refers to.

Two things are deliberately kept apart throughout: **what the code does today** (a lot of it real,
some of it a documented stand-in), and **what it's designed to do once the pieces it's waiting on
exist**. Where they differ, this file says so explicitly rather than describing the target as if
it were already true.

---

## Complete Project Architecture Flow

### High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER INTERACTION LAYER                             │
│                     (React Native UI - src/navigation/)                      │
├─────────────────┬───────────────────────────────┬──────────────────────────┤
│   BookListScreen│           │                   │      ReaderScreen         │
│   - Tap to Open│           │                   │                           │
│   - Tap Download│          │                   │ - Receives decrypted bytes │
└─────────────────┴───────────────────────────────┴──────────────────────────┘
          │                          │                              ▲
          │                          │                              │
          │ openBook()               │ downloadBook()              │ bytes
          │ intent:'STREAM'          │ intent:'DOWNLOAD'           │
          │                          │                             │
          ▼                          ▼                             │
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DOWNLOAD ORCHESTRATION LAYER                         │
│                      (src/features/download/)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐       ┌──────────────────┐      ┌─────────────────┐ │
│  │  openBook.ts     │       │downloadManager.ts│      │ readerAssets.ts│ │
│  │  - License check │       │- License check   │      │- getBookBase64 │ │
│  │  - Fetch if not  │       │- Storage check   │      │- getFormat     │ │
│  │    on disk       │       │- Book limit check│      │- prepareBook   │ │
│  │  - Store in RAM  │       │- Fetch content   │      │                 │ │
│  │    (Elite)       │       │- Store to disk   │      │ Reader's only  │ │
│  └──────────────────┘       │- Record download │      │ entry point    │ │
│                             └──────────────────┘      └─────────────────┘ │
│                                      │                         ▲           │
│                                      └─────────────────────────┘           │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         checkLicense()                               │  │
│  │  - Unified gate for both Open and Download                          │  │
│  │  - Calls: openReadingSession() [intent: 'STREAM' or 'DOWNLOAD']     │  │
│  │  - Generates device keypair if needed                               │  │
│  │  - Synthesizes licence with key fingerprint                         │  │
│  │  - Falls back to offline licence if network down                    │  │
│  │  - Returns: LicenseCheckResult {ok, mode, session, licence}         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                      ▲                                     │
│                                      │                                     │
│  ┌──────────────────────────────────┴──────────────────────────────────┐  │
│  │          readingSessionClient.ts - Real Flambeau Contract           │  │
│  │  - openReadingSession(bookId, {format, intent, devicePublicKey})    │  │
│  │  - Returns: ReadingSessionResponse {encryption, content, etc}       │  │
│  │  - Single call (no separate borrow step - backend merged them)       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                      ▲                                     │
└──────────────────────────────────────┼─────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │   Backend Service                  │
                    │   (tf_reader_backend_temp:8080)   │
                    │                                    │
                    │  POST /api/v1/reading-sessions     │
                    │  - Real RSA-OAEP-256 wrapping      │
                    │  - Real AES-256-GCM encryption     │
                    │  - Real device key management      │
                    └────────────────────────────────────┘
```

---

## Function Call Flow - Detailed Sequence Diagrams

### SCENARIO 1: Opening a Book Not on Disk (New Book)

```
User Action: Tap book row in BookListScreen
     │
     ├─── openBook(bookId, format)
     │     [src/features/download/openBook.ts:36]
     │
     ├─── checkLicense(bookId, format, 'STREAM')
     │     [src/features/download/licenseCheck.ts:129]
     │     │
     │     ├─── generateDeviceKeypair()
     │     │     [src/features/encryption/deviceKeypair.ts]
     │     │     (Generates/retrieves device RSA keypair)
     │     │
     │     ├─── publicKeyToRawBase64(publicKey)
     │     │     (Converts key to wire format)
     │     │
     │     ├─── publicKeyFingerprint(publicKey)
     │     │     (Creates SHA-256 fingerprint for anti-substitution check)
     │     │
     │     ├─── openReadingSession(bookId, {format, intent:'STREAM', devicePublicKey, ...})
     │     │     [src/features/download/readingSessionClient.ts]
     │     │     │
     │     │     └─── POST /api/v1/reading-sessions → Backend
     │     │           Response: ReadingSessionResponse
     │     │           {
     │     │             licenceModel: 'SUBSCRIPTION'|'OPEN_ACCESS'|'ELITE',
     │     │             canPersist: true|false,
     │     │             encryption: { wrappedBek, keyFingerprint, ... },
     │     │             content: { url, cipherLength, originalLength, mimeType },
     │     │             index?: { url, encrypted, termCount },
     │     │             expiresAt: "...",
     │     │             sessionId: "..."
     │     │           }
     │     │
     │     ├─── Anti-key-substitution check
     │     │     [licenseCheck.ts:166]
     │     │     if (session.encryption.keyFingerprint !== deviceKeyFingerprint)
     │     │       → return {ok:false, reason: KEY_SUBSTITUTION}
     │     │
     │     ├─── synthesiseLicence(session, deviceKeyFingerprint, 'STREAM')
     │     │     [licenseCheck.ts:73]
     │     │     Creates SignedLicence:
     │     │     {
     │     │       licenceId: session.licenceId,
     │     │       itemId: session.itemId,
     │     │       keyFingerprint: deviceKeyFingerprint,
     │     │       expiresAt: '9999-12-31...' (placeholder),
     │     │       canPersist: session.canPersist,
     │     │       rights: { print: false },
     │     │       signature: { alg: 'RS256', kid: 'flambeau-unsigned', value: '' }
     │     │     }
     │     │
     │     └─── return {ok:true, mode:'online', session, licence}
     │
     ├─── License check result validation [openBook.ts:38]
     │     if (!license.ok) → throw DownloadFailure
     │
     ├─── Check if already on disk [openBook.ts:46]
     │     if (isAvailableOffline(bookId)) 
     │       → skip fetch, go directly to decrypt (see SCENARIO 2)
     │
     ├─── NOT on disk → Fetch encrypted asset [openBook.ts:78]
     │     fetchEncryptedAssetChunked(bookId, session.content.url, {
     │       maxBytes: MAX_DECRYPTED_BYTES + NONCE_BYTES + GCM_TAG_BYTES
     │     })
     │     [src/features/download/chunkedAssetFetcher.ts]
     │     │
     │     ├─── Chunked download with resumability
     │     ├─── Budget check on first chunk (fail early on oversized content)
     │     └─── Returns: Uint8Array (encrypted bytes)
     │
     ├─── Build EncryptedPackage [openBook.ts:129]
     │     {
     │       bookId,
     │       format,
     │       content: bytes,              // Encrypted ciphertext
     │       encryption: session.encryption,
     │       licence: { ...licence, canPersist: FALSE }, // FORCED false
     │       cipherLength: bytes.length,
     │       originalLength,
     │       mimeType
     │     }
     │     (Note: canPersist FORCED false regardless of real tier)
     │
     ├─── contentStore.store(pkg) [openBook.ts:146]
     │     [src/features/encryption/contentStore.ts:150]
     │     │
     │     ├─── Validate package: assertLengthInvariant(), assertLicenceMatchesPackage()
     │     │
     │     ├─── Since canPersist=false (Elite path):
     │     │     packageCache.set(bookId, pkg)  // RAM only, no disk write
     │     │
     │     └─── return
     │
     ├─── contentStore.openSession(bookId) [openBook.ts:147]
     │     [src/features/encryption/contentStore.ts:200]
     │     │
     │     ├─── Load from cache (just created): resolvePackage() → returns from packageCache
     │     │
     │     └─── return SessionHandle {
     │           bookId, format, content (Uint8Array), encryption, ...
     │         }
     │
     ├─── contentStore.decryptBook(bookId) [openBook.ts:148]
     │     [src/features/encryption/contentStore.ts:220]
     │     │
     │     ├─── Retrieve session from sessionMap
     │     │
     │     ├─── Since encryption present (Subscription-like):
     │     │     
     │     │     ├─── getBek(bookId) [keyStorage.ts]
     │     │     │     (First call - not in cache yet)
     │     │     │
     │     │     ├─── unwrapBek(wrappedBek) [deviceKeypair.ts]
     │     │     │     Uses: React-native-quick-crypto
     │     │     │     - RSA-OAEP-256 decryption
     │     │     │     - Decrypts the wrapped BEK using device private key
     │     │     │     - Returns: raw 32-byte AES-256 key
     │     │     │
     │     │     ├─── storeBek(bookId, rawKey) [keyStorage.ts]
     │     │     │     (Cache for next time - Elite path skips this)
     │     │     │
     │     │     └─── Skip - Elite never writes to keychain
     │     │
     │     ├─── decrypt(session.content, rawKey) [aesGcm.ts]
     │     │     Uses: React-native-quick-base64 + native crypto
     │     │     │
     │     │     ├─── Extract: nonce (12 bytes), ciphertext, tag (16 bytes)
     │     │     │
     │     │     ├─── AES-256-GCM decryption
     │     │     │     - GCM tag verified by native module (fail-closed on mismatch)
     │     │     │     - Returns: plaintext Uint8Array
     │     │     │
     │     │     └─── Whole-book decrypt into RAM
     │     │
     │     └─── return plaintext bytes
     │
     ├─── Navigate to ReaderScreen with bookId
     │
     └─── ReaderScreen.tsx mounted
           │
           ├─── prepareBook(bookId) [readerAssets.ts:119]
           │     │
           │     └─── getFormat(bookId) [contentProvider.ts:71]
           │           └─── contentStore.openSession() → returns format
           │
           ├─── getBookBase64(bookId, format) [readerAssets.ts:188]
           │     │
           │     ├─── verifyReadingAccess(bookId, format)
           │     │     [readingSessionClient.ts]
           │     │     │
           │     │     └─── POST /api/v1/reading-sessions (second call, STREAM intent)
           │     │           (Re-verify entitlement every open)
           │     │           Fails open on network, fails closed on explicit denial
           │     │
           │     ├─── getBook(bookId) [contentProvider.ts:61]
           │     │     │
           │     │     ├─── contentStore.openSession(bookId)
           │     │     │
           │     │     └─── contentStore.decryptBook(bookId)
           │     │           (Second decrypt - same session)
           │     │           Returns plaintext bytes
           │     │
           │     ├─── fromByteArray(bytes) [react-native-quick-base64]
           │     │     (C++-backed base64 encode, ~18ms)
           │     │
           │     └─── return base64 string
           │
           ├─── getReaderHtmlUri(format) [readerAssets.ts:76]
           │     Resolves bundled HTML shell for format
           │     (EPUB: reader-epub.html, PDF: reader-pdf.html)
           │
           └─── ReaderWebView mounted with:
                 - htmlUri
                 - base64 bytes
                 - Sends command: open(base64, bookId)
                 - WebView decodes base64 → plaintext → renders in epub.js/pdf.js

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FINAL STATE:
├─ Ciphertext: Cached in RAM (packageCache)
├─ Plaintext: Cached in RAM (sessionMap.plaintext, for this session only)
├─ Disk: Nothing persisted (Elite treatment forced on openBook)
└─ Reader: Displaying decrypted content via WebView bridge
```

---

### SCENARIO 2: Downloading a Book (Persisted to Disk)

```
User Action: Tap Download button
     │
     └─── downloadBook(bookId, format='EPUB', options={})
           [src/features/download/downloadManager.ts:155]
           │
           ├─── checkStoragePermission()
           │     [permissions.ts] → Platform-specific check (iOS/Android)
           │
           ├─── checkAvailableStorage()
           │     Ensures device has space for decrypted book (MAX_DECRYPTED_BYTES)
           │
           ├─── checkLicense(bookId, format, 'DOWNLOAD')
           │     [licenseCheck.ts:129]
           │     (Same as SCENARIO 1, but intent='DOWNLOAD')
           │     │
           │     ├─── Backend refuses if ELITE tier
           │     │     → Response: DOWNLOAD_NOT_PERMITTED error
           │     │     → Throws DownloadFailure
           │     │     → User must use openBook() instead
           │     │
           │     └─── For SUBSCRIPTION/OPEN_ACCESS:
           │           Returns {ok:true, mode:'online'|'open-access', session, licence}
           │
           ├─── Validate result [downloadManager.ts:181]
           │     if (!license.ok) → throw DownloadFailure
           │
           ├─── Book limit check [downloadManager.ts:211]
           │     assertBookLimitNotExceeded(bookId, rows)
           │     (5-book offline cap, Subscription only)
           │
           ├─── Fetch encrypted asset [downloadManager.ts:233]
           │     fetchEncryptedAssetChunked(bookId, session.content.url, {
           │       maxBytes: maxCipherBytes,
           │       onProgress: options.onProgress  // Progress reporting
           │     })
           │     │
           │     ├─── Chunked download (1 MiB chunks)
           │     ├─── Resumable (saves partial state)
           │     ├─── Budget check on first chunk (fail-fast on oversized)
           │     └─── Returns: Uint8Array (encrypted bytes)
           │
           ├─── Fetch search index (optional, best-effort) [downloadManager.ts:320]
           │     if (session.index)
           │       fetchEncryptedAsset(bookId, session.index.url)
           │       (Small payload, single fetch, failures don't fail the download)
           │
           ├─── Build EncryptedPackage [downloadManager.ts:330]
           │     {
           │       bookId,
           │       format,
           │       content: bytes,           // Encrypted ciphertext
           │       encryption: session.encryption,
           │       index: indexBytes || null,
           │       licence: licence,         // REAL canPersist (NOT forced)
           │       cipherLength,
           │       originalLength,
           │       mimeType
           │     }
           │     (Key difference: Real canPersist, Real licence)
           │
           ├─── contentStore.store(pkg) [downloadManager.ts:340]
           │     [src/features/encryption/contentStore.ts:150]
           │     │
           │     ├─── Validate package
           │     │
           │     ├─── For Subscription (canPersist=true):
           │     │     │
           │     │     ├─── Write to disk:
           │     │     │     ${bookId}.content.bin  (ciphertext)
           │     │     │     ${bookId}.index.bin    (encrypted index, if present)
           │     │     │     ${bookId}.meta.json    (metadata including licence)
           │     │     │
           │     │     └─── packageCache.set(bookId, pkg)  (RAM cache for this session)
           │     │
           │     └─── For Open Access (licence=null):
           │           Same disk write, no keychain operations needed
           │
           ├─── Record in download database [downloadManager.ts:345]
           │     downloadTable.saveLocal({
           │       book_id: bookId,
           │       user_id: USER_ID,
           │       format,
           │       downloaded_at: nowIso(),
           │       synced: false  // Will sync to backend later
           │     })
           │
           ├─── Sync service picks up new download
           │     (offlineLock.ts monitors downloads)
           │
           └─── return
```

---

### SCENARIO 3: Reopening a Downloaded Book (Already on Disk)

```
User Action: Tap previously-downloaded book row
     │
     └─── openBook(bookId, format)
           [src/features/download/openBook.ts:36]
           │
           ├─── checkLicense(bookId, format, 'STREAM')
           │     [licenseCheck.ts:129]
           │     │
           │     ├─── Network call attempt (same as SCENARIO 1)
           │     │
           │     ├─── If network succeeds:
           │     │     return {ok:true, mode:'online'|'open-access', session, licence}
           │     │
           │     └─── If network fails (genuine error only):
           │           offlineFallback(bookId)
           │           [licenseCheck.ts:208]
           │           │
           │           ├─── Get persisted licence from disk
           │           │     getPersistedLicenceStatus(bookId)
           │           │     [contentStore.ts - reads meta.json]
           │           │
           │           ├─── Check revocation status [offlineFallback:236]
           │           │     downloadStore.isBookValid(bookId)
           │           │     (is_valid field from sync pull)
           │           │     If false → invalidateLicence(bookId)
           │           │     (Strip licence+BEK, ciphertext stays on disk)
           │           │
           │           ├─── Check expiry [offlineFallback:246]
           │           │     computeOfflineLicenceExpiry(licence.expiresAt)
           │           │     = min(now + 4 days, licence.expiresAt)
           │           │     If expired → ENTITLEMENT_EXPIRED
           │           │
           │           └─── return {ok:true, mode:'offline-license', licence}
           │
           ├─── Check if on disk [openBook.ts:46]
           │     contentStore.isAvailableOffline(bookId)
           │     If true → proceed directly to decrypt
           │
           ├─── Load persisted package from disk [openBook.ts:47]
           │     contentStore.openSession(bookId)
           │     [contentStore.ts:200]
           │     │
           │     ├─── resolvePackage(bookId)
           │     │     │
           │     │     ├─── Check packageCache first (warm path)
           │     │     │
           │     │     └─── Cache miss:
           │     │           loadPersisted(bookId)
           │     │           [contentStore.ts:290]
           │     │           │
           │     │           ├─── Read meta.json from disk
           │     │           │     Deserialize PersistedMeta
           │     │           │
           │     │           ├─── Read ciphertext from disk (SYNCHRONOUS)
           │     │           │     contentFile(bookId).bytesSync()
           │     │           │     (Whole file, 25 MB possible)
           │     │           │     (This is expensive - owned by Encryption)
           │     │           │
           │     │           ├─── Reconstruct EncryptedPackage
           │     │           │
           │     │           ├─── Check licence expiry [contentStore.ts:302]
           │     │           │     isLicenceExpired(pkg)
           │     │           │     If true → ContentFailure(LICENCE_EXPIRED)
           │     │           │
           │     │           └─── packageCache.set(bookId, pkg)
           │     │
           │     └─── sessionMap.set(bookId, handle)
           │           return SessionHandle
           │
           ├─── Decrypt from disk [openBook.ts:48]
           │     contentStore.decryptBook(bookId)
           │     [contentStore.ts:220]
           │     │
           │     ├─── Retrieve session from sessionMap
           │     │
           │     ├─── Since encryption present:
           │     │     
           │     │     ├─── getBek(bookId) [keyStorage.ts]
           │     │     │     First attempt: Check keychain cache
           │     │     │     Cache miss: Must unwrap BEK (see below)
           │     │     │
           │     │     ├─── unwrapBek(wrappedBek) [deviceKeypair.ts]
           │     │     │     This is where B17 was broken:
           │     │     │     - Device private key unwraps BEK via RSA-OAEP-256
           │     │     │     - MGF1 and digest must both be SHA-256 (now fixed)
           │     │     │     - If key is wrong device → ContentFailure(KEYSTORE_UNAVAILABLE)
           │     │     │
           │     │     ├─── storeBek(bookId, rawKey) [keyStorage.ts]
           │     │     │     Cache in platform keychain for next time
           │     │     │
           │     │     └─── decrypt(ciphertext, rawKey) [aesGcm.ts]
           │     │           AES-256-GCM decryption
           │     │           GCM tag verified → plaintext
           │     │
           │     └─── return plaintext bytes
           │
           ├─── Navigate to ReaderScreen
           │
           └─── (Same Reader flow as SCENARIO 1)
```

---

## Core Encryption & Decryption Functions

### Device Key Management

```
generateDeviceKeypair()
[src/features/encryption/deviceKeypair.ts]
┌─────────────────────────────────────────────────────┐
│ WHY: Each device needs a unique RSA keypair for     │
│ backend to wrap the AES-256 BEK to this device only │
├─────────────────────────────────────────────────────┤
│ WHAT IT DOES:                                       │
│ 1. Check keychain for existing keypair              │
│ 2. If absent: Generate new RSA-4096 keypair         │
│    (via react-native-quick-crypto)                  │
│ 3. Store private key in secure keychain             │
│ 4. Return {publicKey, privateKey}                   │
├─────────────────────────────────────────────────────┤
│ CALLED BY:                                          │
│ - checkLicense() — every book open (need to send    │
│   public key to backend)                            │
│ - unwrapBek() — decrypt the wrapped BEK            │
└─────────────────────────────────────────────────────┘

publicKeyFingerprint(publicKey)
[src/features/encryption/deviceKeypair.ts]
┌─────────────────────────────────────────────────────┐
│ WHY: Anti-key-substitution check (C7/B3 in          │
│ CONTRACT_ALIGNMENT.md) — detect if a different      │
│ device's key is being used                          │
├─────────────────────────────────────────────────────┤
│ WHAT IT DOES:                                       │
│ 1. Hash public key with SHA-256                     │
│ 2. Return hex-encoded fingerprint                   │
├─────────────────────────────────────────────────────┤
│ FLOW:                                               │
│ Backend receives devicePublicKey                    │
│  → Wraps BEK to this key                            │
│  → Sends back keyFingerprint (hash of wrapped key)  │
│                                                     │
│ Client computes its own fingerprint                 │
│  → Compares against backend's fingerprint           │
│  → MISMATCH = different key, reject KEY_SUBSTITUTION│
│  → Prevents device impersonation/key swaps          │
├─────────────────────────────────────────────────────┤
│ CALLED BY:                                          │
│ - checkLicense() — to send to backend and verify    │
│   response fingerprint matches                      │
└─────────────────────────────────────────────────────┘

unwrapBek(wrappedBek)
[src/features/encryption/deviceKeypair.ts]
┌─────────────────────────────────────────────────────┐
│ WHY: Decrypt the wrapped BEK using device's         │
│ private key. BEK is what decrypts the book.         │
├─────────────────────────────────────────────────────┤
│ WHAT IT DOES:                                       │
│ 1. Retrieve device private key from keychain        │
│ 2. Use RSA-OAEP-256 to decrypt wrappedBek          │
│    (OAEPParameterSpec SHA-256 on both digest+MGF1) │
│ 3. Return raw 32-byte AES-256 key                   │
├─────────────────────────────────────────────────────┤
│ ERROR CASES:                                        │
│ - Key not in keychain → KEYSTORE_UNAVAILABLE       │
│ - wrappedBek doesn't decrypt → KEYSTORE_UNAVAILABLE│
│   (Wrong device or corrupted value)                 │
│ - (B17) SHA-1 mismatch on backend → always failed   │
│   until RSA-OAEP-256 params fixed                   │
├─────────────────────────────────────────────────────┤
│ CALLED BY:                                          │
│ - contentStore.decryptBook() — when BEK not cached │
│   in keychain yet                                   │
└─────────────────────────────────────────────────────┘
```

### BEK (Book Encryption Key) Storage

```
getBek(bookId)
[src/features/encryption/keyStorage.ts]
┌─────────────────────────────────────────────────────┐
│ WHY: The BEK is expensive to unwrap (RSA-OAEP-256)  │
│ so cache it locally after first unwrap              │
├─────────────────────────────────────────────────────┤
│ WHAT IT DOES:                                       │
│ 1. Check in-memory cache (keyMap)                   │
│ 2. If miss: Check platform keychain                 │
│ 3. If found: Cache in memory for this session       │
│ 4. If all miss: Return null → caller unwraps BEK   │
├─────────────────────────────────────────────────────┤
│ RETURN: 32-byte Uint8Array (raw AES key) or null   │
└─────────────────────────────────────────────────────┘

storeBek(bookId, rawKey)
[src/features/encryption/keyStorage.ts]
┌─────────────────────────────────────────────────────┐
│ WHY: After unwrapping BEK, cache it so next open    │
│ doesn't need RSA decryption again                    │
├─────────────────────────────────────────────────────┤
│ WHAT IT DOES:                                       │
│ 1. Store in in-memory cache (keyMap)                │
│ 2. Store in platform keychain (iOS/Android secure) │
├─────────────────────────────────────────────────────┤
│ CALLED BY:                                          │
│ - contentStore.decryptBook() — after unwrapBek()   │
│                                                     │
│ BUT NOT FOR ELITE:                                  │
│ - Elite books never call this                       │
│ - Their BEK is unwrapped but never cached           │
│ - On close(), no need to zeroize keychain (none)    │
└─────────────────────────────────────────────────────┘

deleteBek(bookId)
[src/features/encryption/keyStorage.ts]
┌─────────────────────────────────────────────────────┐
│ WHY: On license revocation, strip cached BEK        │
│ so it can't be used again                           │
├─────────────────────────────────────────────────────┤
│ WHAT IT DOES:                                       │
│ 1. Remove from in-memory cache                      │
│ 2. Delete from keychain                             │
│ 3. Ciphertext stays on disk (can re-attach licence) │
├─────────────────────────────────────────────────────┤
│ CALLED BY:                                          │
│ - invalidateLicence() → on revocation detected      │
│ - close() → (2026-08-18) cleanup on book close      │
│   (KNOWN ISSUE #1: breaks Elite re-open)            │
└─────────────────────────────────────────────────────┘
```

### Plaintext Decryption

```
decrypt(ciphertext, aesKey)
[src/features/encryption/aesGcm.ts]
┌─────────────────────────────────────────────────────┐
│ WHY: Decrypt the book bytes with the unwrapped BEK  │
├─────────────────────────────────────────────────────┤
│ LAYOUT:                                             │
│ Ciphertext = nonce(12B) || encrypted(N) || tag(16B)│
│                                                     │
│ WHAT IT DOES:                                       │
│ 1. Extract nonce (first 12 bytes)                   │
│ 2. Extract ciphertext (middle N bytes)              │
│ 3. Extract tag (last 16 bytes)                      │
│ 4. Call native createDecipheriv('aes-256-gcm')      │
│    (via react-native-quick-crypto)                  │
│ 5. Set IV = nonce                                   │
│ 6. Decrypt ciphertext with AES-256-GCM             │
│ 7. Verify GCM authentication tag                    │
│    (Tag check is fail-closed - integrity failure)   │
│ 8. Return plaintext                                 │
├─────────────────────────────────────────────────────┤
│ PERF: ~93% of warm open time (4.9s out of 5.2s)     │
│ - Codec bottleneck is here, not in Reader           │
│ - 2026-08-11 codec swap brought ~47x speedup        │
├─────────────────────────────────────────────────────┤
│ CALLED BY:                                          │
│ - contentStore.decryptBook()                        │
│ - By extension: all Reader opens                    │
└─────────────────────────────────────────────────────┘
```

---

## License Synthesis & Verification

```
synthesiseLicence(session, deviceKeyFingerprint, intent)
[src/features/download/licenseCheck.ts:73]
┌────────────────────────────────────────────────────────┐
│ WHY: Neither wokay nor flambeau's contract provides    │
│ a SignedLicence type. This constructs one from the     │
│ session response parts.                               │
├────────────────────────────────────────────────────────┤
│ WHAT IT CREATES:                                       │
│ {                                                      │
│   licenceId: session.licenceId || session.sessionId,   │
│   itemId: session.itemId,                              │
│   keyFingerprint: deviceKeyFingerprint,  ← REAL        │
│   expiresAt: '9999-12-31T23:59:59Z',     ← PLACEHOLDER │
│   canPersist: session.canPersist,        ← REAL        │
│   rights: { print: (intent === 'DOWNLOAD') },          │
│   signature: { alg: 'RS256', kid: '', value: '' }      │
│ }                                                      │
│                                                        │
│ REAL FIELDS:                                           │
│ - keyFingerprint: Used for anti-substitution check     │
│ - canPersist: Determines if ciphertext persists to     │
│               disk (Elite vs Subscription)             │
│                                                        │
│ PLACEHOLDER FIELDS:                                    │
│ - expiresAt: Far-future placeholder. Real due-date     │
│   from backend would be used once available.           │
│   For now, 4-day offline cap computed separately.      │
│ - signature: Never verified. Part of OPEN ITEM B4      │
│   (whether signed licence should exist at all)         │
├────────────────────────────────────────────────────────┤
│ CALLED BY:                                             │
│ - checkLicense() — for every book open/download        │
└────────────────────────────────────────────────────────┘

verifyLicenceSignature(licence)
[src/features/encryption/licenceSignature.ts]
┌────────────────────────────────────────────────────────┐
│ CURRENT: Always returns true (stub)                    │
│ RS256 verification is NOT wired in                     │
│                                                        │
│ FUTURE: When backend provides real signatures,         │
│ this function should verify the RS256 signature        │
│ against the backend's public key                       │
├────────────────────────────────────────────────────────┤
│ RELATED OPEN ITEMS:                                    │
│ - B4: Whether SignedLicence should exist at all        │
│ - No publisher key in any contract yet                 │
└────────────────────────────────────────────────────────┘

computeOfflineLicenceExpiry(candidateExpiry)
[src/features/download/licenseCheck.ts:99]
┌────────────────────────────────────────────────────────┐
│ WHY: Without a real due-date from backend, enforce    │
│ a 4-day offline cap from last successful open         │
├────────────────────────────────────────────────────────┤
│ FORMULA:                                               │
│ = min(now + 4 days, candidateExpiry)                   │
│                                                        │
│ TODAY: Always = now + 4 days (since expiry is          │
│ placeholder far-future)                                │
│                                                        │
│ WHEN BACKEND ADDS DUE-DATE:                            │
│ = whichever comes first: 4 days from now, or the       │
│   backend's published loan due date                    │
├────────────────────────────────────────────────────────┤
│ CALLED BY:                                             │
│ - offlineFallback() → checked when opening offline     │
│ - On every offline reopen, timeout resets (not         │
│   sticky from download time)                           │
└────────────────────────────────────────────────────────┘
```

---

## Reader Integration Points

### How Reader Gets Decrypted Bytes

```
ReaderScreen Lifecycle
[src/features/reader/ReaderScreen.tsx]

1. MOUNT
   ├─── useEffect(() => { loadBook() }, [bookId])
   │
   ├─── prepareBook(bookId)
   │    [readerAssets.ts:119]
   │    └─── getFormat(bookId)
   │          └─── contentStore.openSession(bookId)
   │               └─── Returns: ContentFormat ('EPUB'|'PDF'|'AUDIO')
   │
   ├─── Conditionally render WebView based on format
   │
   └─── getReaderHtmlUri(format)
        [readerAssets.ts:76]
        └─── Resolve bundled HTML shell URI
             (EPUB: reader-epub.html, PDF: reader-pdf.html)

2. READY (WebView loaded)
   └─── ReaderWebView.tsx reports 'ready'
        └─── ReaderScreen triggers byte loading

3. LOAD BYTES
   └─── getBookBase64(bookId, format)
        [readerAssets.ts:188]
        │
        ├─── verifyReadingAccess(bookId, format)
        │    Re-verify entitlement on every open
        │    POST /api/v1/reading-sessions (fail-open on network)
        │
        ├─── getBook(bookId)
        │    [contentProvider.ts:61]
        │    └─── contentStore.openSession() + decryptBook()
        │         Returns: Uint8Array plaintext
        │
        ├─── fromByteArray(bytes)
        │    [react-native-quick-base64 - C++ native]
        │    Returns: base64 string (27.9 MB for 20 MB book)
        │
        └─── return base64

4. RENDER
   └─── ReaderWebView receives command:
        {
          command: 'open',
          args: {
            base64Data: "JVBERi0xLjQKJ...",  // or epub data
            bookId: "dev-sample-epub"
          }
        }

5. WEBVIEW PROCESSING
   └─── WebView bridge (webview/src/bridge.ts)
        │
        ├─── base64ToArrayBuffer(base64)
        │    Decode base64 to ArrayBuffer
        │
        ├─── For EPUB:
        │    └─── openEpub(arrayBuffer, bookId)
        │         └─── JSZip.loadAsync(arrayBuffer)
        │              Parse EPUB structure
        │         └─── epub.js.Book.open()
        │              Load into renderer
        │         └─── Compute font metrics, styles
        │         └─── Render pages
        │
        └─── For PDF:
             └─── openPdf(arrayBuffer, bookId)
                  └─── pdfjs.getDocument({data: arrayBuffer})
                       Load PDF into renderer
                  └─── Render pages with pdfjs viewer

6. USER INTERACTION
   └─── User navigates, changes font, etc
        └─── WebView sends messages back to Reader
             (onRelocated, onSearch, etc)
        └─── ReaderScreen.tsx handles via bridge

7. UNMOUNT
   └─── useEffect cleanup
        └─── closeBook(bookId)
             [contentProvider.ts:78]
             └─── contentStore.close(bookId)
                  ├─── Clear sessionMap
                  ├─── Zero plaintext buffer
                  ├─── Clear packageCache (Elite+Subscription)
                  └─── Zeroize cached BEK (Subscription only)
```

---

## License Tier Behaviors

```
┌─────────────────┬────────────┬──────────┬──────────────────┬──────────────┐
│ Tier            │ Encrypted? │ Persists?│ Can Download?    │ Online-only? │
├─────────────────┼────────────┼──────────┼──────────────────┼──────────────┤
│ OPEN_ACCESS     │ No*        │ Yes      │ Yes              │ No           │
│ SUBSCRIPTION    │ Yes        │ Yes      │ Yes              │ No           │
│ ELITE           │ Yes        │ No       │ No (server-side) │ Yes          │
└─────────────────┴────────────┴──────────┴──────────────────┴──────────────┘

* OPEN_ACCESS genuinely encrypted in test backend (deliberate shortcut),
  but real open-access would be unencrypted (no key material to protect).

FLOW BY TIER:

┌──────────────────────────────────────────────┐
│ OPEN_ACCESS                                  │
├──────────────────────────────────────────────┤
│ checkLicense() → licenceModel: 'OPEN_ACCESS' │
│                                              │
│ openBook():                                  │
│ ├─ Fetch encrypted asset (despite name)     │
│ ├─ Store in RAM (canPersist forced false)    │
│ └─ Decrypt → plaintext → Reader               │
│                                              │
│ downloadBook():                              │
│ ├─ Fetch encrypted asset                    │
│ ├─ Store ciphertext to disk                 │
│ ├─ licence = null (no rights to track)       │
│ ├─ No keychain BEK needed                    │
│ └─ On reopen: contentStore.isAvailableOffline│
│    → no license check needed                 │
│                                              │
│ Offline support: YES (4+ days indefinite)    │
│ Keychain needed: NO                          │
│ Copy limit: NO (OPDS catalogue limits it)    │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ SUBSCRIPTION                                 │
├──────────────────────────────────────────────┤
│ checkLicense() → licenceModel: 'SUBSCRIPTION'│
│                 canPersist: true             │
│                                              │
│ openBook():                                  │
│ ├─ checkLicense(..., 'STREAM')              │
│ ├─ Fetch encrypted asset                    │
│ ├─ Store in RAM (canPersist forced false)    │
│ ├─ Decrypt → plaintext → Reader              │
│ └─ close() zeros plaintext, drops RAM cache  │
│                                              │
│ downloadBook():                              │
│ ├─ checkLicense(..., 'DOWNLOAD')            │
│ ├─ Fetch encrypted asset                    │
│ ├─ Store ciphertext + licence to disk       │
│ ├─ Keychain: Store wrapped BEK after unwrap │
│ └─ Checked every reopen (4-day cap)         │
│                                              │
│ On reopen:                                   │
│ ├─ If online: License re-check              │
│ ├─ If offline: Use persisted licence        │
│ │             (4-day cap from last open)    │
│ ├─ Fetch ciphertext from disk               │
│ ├─ Unwrap BEK from keychain                 │
│ └─ Decrypt → plaintext → Reader              │
│                                              │
│ Offline support: YES (4 days from last open) │
│ Keychain needed: YES (after first download)  │
│ Copy limit: YES (5-book cap)                │
│ License expiry: Checked on every open        │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ ELITE                                        │
├──────────────────────────────────────────────┤
│ checkLicense() → licenceModel: 'ELITE'       │
│                 canPersist: false            │
│                                              │
│ openBook():                                  │
│ ├─ checkLicense(..., 'STREAM')              │
│ ├─ Fetch encrypted asset                    │
│ ├─ Store in RAM (Elite-shaped, no persist)   │
│ ├─ Decrypt → plaintext → Reader              │
│ └─ close() zeros plaintext, drops RAM cache  │
│                                              │
│ downloadBook():                              │
│ └─ BLOCKED at checkLicense()                 │
│    Server responds: DOWNLOAD_NOT_PERMITTED   │
│    Caller must use openBook() instead        │
│                                              │
│ Offline: NOT SUPPORTED                       │
│ No second call to openBook() works           │
│ (ciphertext never persisted, so nothing on   │
│  disk to decrypt offline)                    │
│                                              │
│ KNOWN ISSUE #1 (CLAUDE.md):                  │
│ close() on Elite calls packageCache.delete() │
│ Even though that's the ONLY copy. An Elite   │
│ book cannot be reopened after close() in the │
│ same session. Fix deferred pending contract  │
│ clarification.                               │
│                                              │
│ Offline support: NO (online-only)            │
│ Keychain needed: NO (BEK never cached)       │
│ Copy limit: NO (never persists)              │
│ License expiry: Checked on first open only   │
└──────────────────────────────────────────────┘
```

---

## Memory & Lifecycle

```
┌─────────────────────────────────────────────────────┐
│ PACKAGE LIFECYCLE                                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│ EncryptedPackage = Ciphertext + Metadata           │
│                                                     │
│ CREATE (store() call):                              │
│ ├─ openBook() for memory-only                       │
│ ├─ downloadBook() for disk + memory                 │
│ └─ devContentSeed.ts for dev fixtures               │
│                                                     │
│ PERSIST (for downloadBook only):                    │
│ ├─ ${bookId}.content.bin     (ciphertext)           │
│ ├─ ${bookId}.index.bin       (encrypted index)      │
│ └─ ${bookId}.meta.json       (metadata + licence)   │
│    Location: Paths.document/tf-reader-content/      │
│                                                     │
│ IN-MEMORY CACHES:                                   │
│ ├─ packageCache    (EncryptedPackage → SessionH)    │
│ ├─ sessionMap      (SessionHandle with plaintext)   │
│ └─ keyMap          (BEK cache)                      │
│                                                     │
│ DESTROY (close() call):                             │
│ ├─ Clear sessionMap entry                           │
│ ├─ Zero plaintext buffer (cryptographic cleanup)    │
│ ├─ Remove from packageCache (2026-08-18 change)     │
│ ├─ Delete BEK from keyMap (if Subscription)         │
│ └─ Delete BEK from keychain (if Subscription)       │
│                                                     │
│ REVOKE (invalidateLicence() call):                  │
│ ├─ Delete licence from meta.json                    │
│ ├─ Delete BEK from keychain                         │
│ └─ Leave ciphertext on disk (can re-attach rights)  │
│                                                     │
└─────────────────────────────────────────────────────┘

PEAK MEMORY ANALYSIS (per CLAUDE.md):
├─ Plaintext copies in flight: ~6 full-size resident
├─ per MB of book: 8.66 MB app peak per MB content
│  (measured: 20 MB EPUB → 172.8 MB net app peak)
│
├─ Time to decrypt (warm): ~4.9s per 20 MB
│  (2026-08-11 codec swap bought 47x speedup)
│  (time now all in Encryption, not Reader)
│
└─ ONLY REMAINING LEVER: Remove copies (streaming, etc)
   (Current design persists whole plaintext in memory,
    not in chunks — design-level change needed)
```

---

---

## System Actors & Entry Points

### Main Functions (What calls what)

```
APPLICATION ENTRY POINTS:
├─ src/navigation/BookListScreen.tsx
│  ├─ Tap "Open" → openBook(bookId, format)
│  └─ Tap "Download" → downloadBook(bookId, format)
│
└─ src/features/reader/ReaderScreen.tsx
   ├─ Mount → prepareBook(bookId)
   ├─ Mount → getReaderHtmlUri(format)
   └─ Ready → getBookBase64(bookId, format)

DOWNLOAD LAYER:
├─ openBook() [src/features/download/openBook.ts]
│  └─ Reads without persisting (memory-only, canPersist forced false)
│
├─ downloadBook() [src/features/download/downloadManager.ts]
│  └─ Reads and persists to disk (real canPersist from backend)
│
└─ checkLicense() [src/features/download/licenseCheck.ts]
   ├─ Unified gate for both Open and Download
   ├─ Calls: openReadingSession() → backend
   ├─ Synthesizes SignedLicence
   ├─ Falls back to offline licence if network fails
   └─ Shared code for consistent license handling

CONTENT PROVIDER SEAM (Reader's surface):
├─ getBook(bookId) [src/features/encryption/contentProvider.ts]
│  ├─ Called by: getBookBase64() in readerAssets.ts
│  ├─ Calls: contentStore.openSession() + contentStore.decryptBook()
│  └─ Returns: Uint8Array plaintext
│
├─ getFormat(bookId) [contentProvider.ts]
│  ├─ Called by: prepareBook() in readerAssets.ts
│  └─ Returns: ContentFormat (EPUB|PDF|AUDIO)
│
├─ getIndex(bookId) [contentProvider.ts]
│  ├─ Called by: src/features/search/ (Search's seam)
│  └─ Returns: encrypted search index bytes or null
│
├─ closeBook(bookId) [contentProvider.ts]
│  ├─ Called by: ReaderScreen unmount effect
│  └─ Cleanup: Zero buffers, drop caches
│
└─ contentProvider {getBook} [contentProvider.ts:76]
   └─ Frozen ContentProvider interface for Reader

ENCRYPTION LAYER (Encryption's internal, Reader doesn't see):
├─ contentStore [src/features/encryption/contentStore.ts]
│  ├─ store(pkg) — Persist or cache package
│  ├─ openSession(bookId) — Load package, return handle
│  ├─ decryptBook(bookId) — Unwrap BEK, decrypt content
│  ├─ close(bookId) — Cleanup on reader unmount
│  └─ isAvailableOffline(bookId) — Check if on disk
│
├─ aesGcm [src/features/encryption/aesGcm.ts]
│  ├─ decrypt(ciphertext, aesKey) — AES-256-GCM decryption
│  └─ Called only by: contentStore.decryptBook()
│
├─ deviceKeypair [src/features/encryption/deviceKeypair.ts]
│  ├─ generateDeviceKeypair() — RSA-4096 device key
│  ├─ publicKeyFingerprint(key) — SHA-256 hash
│  └─ unwrapBek(wrappedBek) — RSA-OAEP-256 unwrap
│
└─ keyStorage [src/features/encryption/keyStorage.ts]
   ├─ getBek(bookId) — Get cached BEK
   ├─ storeBek(bookId, key) — Cache BEK (keychain + memory)
   └─ deleteBek(bookId) — Revoke on license strip
```

---

## 1. The three tiers, and the two things they each answer

Every book has an `AccessTier` — `OPEN_ACCESS`, `SUBSCRIPTION`, or `ELITE` — and the tier answers
two independent questions:

| Tier | Needs an entitlement? | Encrypted? | Can it be downloaded? |
| --- | --- | --- | --- |
| `OPEN_ACCESS` | No | No (in the real design — see §5's caveat) | Yes |
| `SUBSCRIPTION` | Yes | Yes | Yes, persists to disk |
| `ELITE` | Yes, and copy-limited | Yes | **No — online-only, refused server-side** |

This isn't a client convention — it's `RightsService`/`DeviceCapService` on the real backend
(`tf_reader_backend_temp`) enforcing it. `licenceModel`/`canPersist` on the reading-session
response are what the client actually branches on; `AccessTier` is the server's own internal name
for the same three values.

---

## 2. The actors

- **`checkLicense()`** (`download/licenseCheck.ts`) — the single gate both Open and Download go
  through. Calls the real `POST /api/v1/reading-sessions` (flambeau's contract), synthesizes a
  local `SignedLicence` from the response (see §6 for why that's a synthesis, not a real field),
  and falls back to a persisted local licence when the network is genuinely unreachable.
- **`openBook()`** (`download/openBook.ts`) — read a book *now*, nothing persists. Used by
  tapping a row.
- **`downloadBook()`** (`download/downloadManager.ts`) — fetch and persist ciphertext + licence to
  disk. Used by the Download button.
- **`contentStore`** (`encryption/contentStore.ts`) — the only thing that touches ciphertext, the
  keychain, and the decrypted buffer. Implements the frozen `ContentStore` interface
  (`shared/contracts/content-provider.ts`).
- **`getBook()`** (`encryption/contentProvider.ts`) — the ONE call Reader is allowed to make. It
  wraps `contentStore.openSession()` + `decryptBook()`. Reader never reaches past this seam.
- **`tf_reader_backend_temp`** — a real Spring Boot service standing in for wokay's and flambeau's
  eventual production backends (see §7). It's not a mock in the usual sense: the crypto is real
  RSA-OAEP-256 and real AES-256-GCM, over four real encrypted fixture files.

---

## Implementation Details by Layer

### Error Handling & Validation

```
DOWNLOAD LAYER ERROR CODES:
├─ PERMISSION_DENIED
│  └─ User denied storage permission on Android/iOS
│
├─ INSUFFICIENT_STORAGE
│  └─ Device doesn't have space for MAX_DECRYPTED_BYTES
│
├─ BOOK_LIMIT_REACHED
│  └─ Already have 5 books downloaded (Subscription only)
│
├─ SESSION_FETCH_FAILED
│  └─ Network unreachable (genuine error only)
│     If server answered but said no → other error code
│
├─ KEY_SUBSTITUTION (C7)
│  └─ Device fingerprint mismatch (wrong device key)
│
├─ DOWNLOAD_NOT_PERMITTED
│  └─ Elite book refuses DOWNLOAD intent
│     User should use openBook() instead
│
├─ BOOK_TOO_LARGE
│  └─ Decrypted book exceeds MAX_DECRYPTED_BYTES (25 MB)
│
├─ CHECKSUM_MISMATCH
│  └─ content.originalLength disagrees with cipherLength
│
├─ OFFLINE_LICENSE_UNAVAILABLE
│  └─ Network down AND no valid persisted licence
│
├─ ENTITLEMENT_REVOKED
│  └─ License was valid, but is_valid flag is false
│     (Admin revoked access server-side)
│
└─ ENTITLEMENT_EXPIRED
   └─ License expired (4-day offline cap exceeded)

ENCRYPTION LAYER ERROR CODES:
├─ INTEGRITY_FAILED
│  └─ Length invariant violated in package
│
├─ LICENCE_INVALID
│  └─ Encrypted package has no licence, or bad expiry
│
├─ LICENCE_EXPIRED
│  └─ License has expired (checked on open)
│
├─ KEYSTORE_UNAVAILABLE
│  └─ Device private key missing or unwrapBek() failed
│
└─ DECRYPTION_FAILED
   └─ AES-GCM tag verification failed or other decrypt error

READER LAYER ERROR CODES:
├─ UnsupportedFormatError
│  └─ Book format has no renderer (AUDIO)
│
└─ Maps encryption errors to ReaderErrorCode enum
```

### Network Reliability & Timeouts

```
checkLicense() CALL:
├─ Timeout: 8s (REQUEST_TIMEOUT_MS in readingSessionClient)
│  └─ AbortController timer fires if no response
│
├─ Genuine network error → offlineFallback()
│  ├─ No local licence → OFFLINE_LICENSE_UNAVAILABLE
│  ├─ Offline licence + not revoked + not expired
│  │  └─ return {ok:true, mode:'offline-license', licence}
│  └─ Offline licence + revoked
│     └─ invalidateLicence() + ENTITLEMENT_REVOKED
│
├─ Server answered (HTTP response received) →
│  ├─ If FlambeauError mapped (in SESSION_ERROR_CODE_MAP)
│  │  └─ return {ok:false, reason: mapped code}
│  └─ If unmapped HTTP error (500, etc)
│     └─ SESSION_FETCH_FAILED (treated as server error)
│
└─ Guarantee: Fall back ONLY on genuine network error,
   NOT on server errors (avoid masking real problems)

verifyReadingAccess() in getBookBase64:
├─ Called on EVERY open (per-open re-verification)
├─ Timeout: 8s (same REQUEST_TIMEOUT_MS)
├─ Fails OPEN on network (continues with offline book)
│  └─ Download/Encryption already verified access
└─ Fails CLOSED on explicit server denial
   └─ Revocation signal from latest sync pull
```

### Offline & Revocation Mechanics

```
OFFLINE FALLBACK PATH:
1. checkLicense() network call fails with genuine error
2. offlineFallback(bookId) called
3. getPersistedLicenceStatus(bookId) reads meta.json
4. Check: is licence present?
   ├─ No licence (open-access) → {ok:true, mode:'open-access'}
   └─ Licence present:
      ├─ Check downloadStore.isBookValid(bookId)
      │  └─ is_valid flag from last sync pull
      ├─ If false → invalidateLicence() → ENTITLEMENT_REVOKED
      ├─ Check licence expiry (using 4-day cap)
      └─ If expired → ENTITLEMENT_EXPIRED
5. If all checks pass → {ok:true, mode:'offline-license', licence}

REVOCATION FLOW:
1. Backend marks book.is_valid = false
2. Sync service pulls downloads table (sync/offlineLock.ts)
3. downloadStore.isBookValid() returns false
4. Next book open calls offlineFallback()
5. offlineFallback() detects revoked = true
6. Calls invalidateLicence(bookId)
   ├─ Delete licence from meta.json
   ├─ Delete BEK from keychain
   ├─ Write revokedAt timestamp to meta.json
   └─ Leave ciphertext on disk (graceful)
7. Return ENTITLEMENT_REVOKED error
8. Reader shows error banner, book cannot open
9. Fresh online open with new licence can re-attach rights

WHY THIS DESIGN:
├─ Revocation is immediate (pull-based, not push)
├─ Offline doesn't mean "ignores revocation"
├─ Ciphertext persists (can restore rights later)
└─ BEK stripped so it can't decrypt without new rights
```

---

## 3. Opening a book that isn't on disk yet (the common case for a new book)

```
tap row → openBook(bookId, format)
  → checkLicense(bookId, format, 'STREAM')
      → POST /api/v1/reading-sessions  { itemId, format, intent: STREAM, devicePublicKey }
      ← { licenceModel, canPersist, content: { url, cipherLength, ... },
          encryption: { wrappedBek, keyFingerprint, ... } | null,
          index?, expiresAt (session, ~5 min), sessionId }
      → anti-substitution check: session.encryption.keyFingerprint === our own device
        key's fingerprint, or reject KEY_SUBSTITUTION
      → synthesise a local SignedLicence (see §6)
  ← { ok: true, mode: 'online' | 'open-access', session, licence }
  → not on disk (isAvailableOffline() false) → fetchEncryptedAssetChunked(session.content.url)
  → build EncryptedPackage, licence.canPersist FORCED false regardless of the real tier
  → contentStore.store(pkg)          — Elite-shaped: cached in RAM only, nothing written to disk
  → contentStore.openSession(bookId)
  → contentStore.decryptBook(bookId) — unwrap the BEK (RSA-OAEP-256), AES-256-GCM decrypt, whole
                                        book, into RAM. Never touches the keychain (Elite path).
navigate to Reader
  → readerAssets.getBookBase64(bookId, format)
      → verifyReadingAccess(bookId, format)   — a SECOND, lighter reading-session call, STREAM
                                                 intent, fail-open on network errors, fail-closed
                                                 only on an explicit server denial
      → getBook(bookId) → base64-encode → injectJavaScript into the WebView
```

`openBook()` always treats the package as Elite-shaped (`canPersist: false`), **regardless of the
book's real tier** — that's deliberate: opening-without-downloading should never leave ciphertext
on disk, whether the book is Subscription or Elite. Nothing is written to disk on this path, ever.

---

## 4. Downloading a book (the Download button)

```
tap Download → downloadBook(bookId, format)
  → checkStoragePermission(), checkAvailableStorage()
  → checkLicense(bookId, format, 'DOWNLOAD')       — same gate, intent: DOWNLOAD this time
      → an ELITE title's session refuses this intent server-side: DOWNLOAD_NOT_PERMITTED.
        No client-side downgrade — the caller should have used Open instead.
  → assertBookLimitNotExceeded()                    — 5-book cap, real tier's canPersist only
  → fetchEncryptedAssetChunked(), 1 MiB chunks, resumable, budget-checked against
    MAX_DECRYPTED_BYTES (25 MB) as soon as the total is known
  → best-effort fetch the search index, if the session carries one
  → needsLicence = licenceModel !== 'open-access'
    pkg.licence = needsLicence ? licence : null      — real canPersist this time, NOT forced
  → contentStore.store(pkg)
      Subscription (canPersist: true)  → writes bookId.content.bin / .index.bin / .meta.json
      Elite         (canPersist: false) → refused earlier by the server; never reaches here
  → downloadTable.saveLocal(...)                     — records the download in SQLite
```

## 5. Reopening a downloaded book (the exact case that was broken until today)

```
tap row → openBook(bookId, format)
  → checkLicense(..., 'STREAM')                      — same live check as any other open
  → contentStore.isAvailableOffline(bookId) → true
  → contentStore.openSession(bookId)  → loadPersisted() reads meta.json + content.bin off disk
  → contentStore.decryptBook(bookId)
      isElite(pkg) is FALSE here (the real, persisted licence.canPersist is true for Subscription)
      → getBek(bookId) — keychain cache, miss on first read after a fresh download
      → unwrapBek(pkg.encryption.wrappedBek) — RSA-OAEP-256 unwrap
      → storeBek(bookId, rawKey) — cache for next time
      → AES-256-GCM decrypt, whole book, into RAM
```

**This is the path `B17` broke.** The backend's wrap used to produce ciphertext with MGF1 tied to
SHA-1 while the digest was SHA-256; the client's `unwrapBek()` (correctly) requires both to match
at SHA-256. Every `unwrapBek()` call surfaced as `ContentFailure(KEYSTORE_UNAVAILABLE)` — a
misleading name, since the Android/iOS keychain was never the problem; the ciphertext itself
didn't correspond to a valid RSA-OAEP-256 encryption under any key. Fixed by adding an explicit
`OAEPParameterSpec` on the backend's `Cipher.init()` — see `CONTRACT_ALIGNMENT.md`'s `B17` entry
for the full trail. Confirmed fixed on-device, this exact code path, both platforms.

---

## 6. The one deliberate gap in the middle: `SignedLicence` is synthesized, not received

`content-provider.ts`'s frozen `ContentStore.store()` requires an `EncryptedPackage.licence` with
`expiresAt` / `canPersist` / `rights` / a `signature`. **Neither published contract sends anything
shaped like that.** wokay's `ContentGrant` is exactly `content` / `index` / `encryption`;
flambeau's `ReadingSessionResponse` adds only session-scoped fields (`licenceModel`, `canPersist`,
`expiresAt` — the session's own ~5-minute one, not a licence's). So `checkLicense.ts`'s
`synthesiseLicence()` builds one locally:

```ts
{
  licenceId: session.licenceId ?? session.sessionId,
  itemId: session.itemId,
  keyFingerprint: deviceKeyFingerprint,        // real, and load-bearing (see below)
  expiresAt: '9999-12-31T23:59:59.000Z',       // placeholder — see next paragraph
  canPersist: session.canPersist ?? true,      // real
  rights: { print: intent === 'DOWNLOAD' },    // not from any contract
  signature: { alg: 'RS256', kid: 'flambeau-unsigned', value: '' },  // never verified, by anyone
}
```

Two fields are real and load-bearing: `keyFingerprint` (compared against
`session.encryption.keyFingerprint` as the anti-key-substitution check) and `canPersist` (the
Subscription-vs-Elite switch). The rest is scaffolding around a shape the real backend has no
opinion on yet. `expiresAt` is a far-future placeholder because **the real backend has no
loan-due-date field anywhere** (`GET /api/v1/loans` returns `dueAt: null` for every seeded loan) —
so the actual offline bound is computed separately:

```ts
computeOfflineLicenceExpiry(candidateExpiry) = min(now + 4 days, candidateExpiry)
```

Today `candidateExpiry` is always the far-future placeholder, so the real bound is always
**4 days from the last successful open**. Once the backend publishes a real due-date, this
naturally tightens to whichever is sooner.

`signature` is never verified — `contentStore.ts` checks expiry for real but has no RS256 verify
wired in. This is `B4` in `CONTRACT_ALIGNMENT.md`: whether a signed licence should exist in this
system at all is an open cohort question, not a bug to quietly fix.

---

## 7. What's real, what's a stand-in, and what that means for "how are we able to read this"

| Piece | Today | Meant to become |
| --- | --- | --- |
| Backend | `tf_reader_backend_temp` — one real Spring Boot process, real crypto, MongoDB | wokay's real catalogue/content service + flambeau's real auth/loan/reading service, as two separate deployed systems the two published contracts describe |
| Auth | `devAuthToken.ts` → `POST /api/v1/auth/dev-token`, a **dev-only shortcut the real backend itself ships** — no credential, mints a real signed token | Real SAML browser round-trip (`C6` — still an open question for another team: neither contract says how the app receives its token after that redirect) |
| Which books exist | Four hardcoded dev fixture IDs (`dev-sample-epub/pdf`, `dev-fixture-epub/pdf`) wired into `BookListScreen.tsx`, seeded via `demo-dataset.json` | A real OPDS catalogue feed (wokay) the app browses, with real itemIds Download never has to know in advance |
| Book encryption key | `MOCK_BEK` — one fixed AES-256 key, hardcoded in `ContentAccessGrantImpl.java`, used for **every** fixture | A real per-book BEK, generated at ingest time, wrapped fresh per device per session — the wrapping mechanics (RSA-OAEP-256 to the device's public key) are already the real, final design |
| Borrow/loan | No call at all — `POST /api/v1/loans` 405s on the real backend; `licenceModel`/`canPersist` come straight off the reading-session response | Unresolved contract disagreement (`B18`): flambeau's published spec still marks the endpoint FROZEN. Needs a ruling, not a client change |
| `dev-sample-*`'s tier/encryption combo | `OPEN_ACCESS` tag, but genuinely AES-256-GCM encrypted (see the question this file opened with) — a deliberate backend shortcut so the crypto path has something to exercise without an entitlement | Real open-access content is never encrypted (audio for the same seek-related reason) — this combination shouldn't exist in the final system |
| Licence signature | Placeholder, unverified (§6) | Either a real signed licence from the backend, or the field is dropped — `B4`, undecided |

None of the "stand-in" rows are hidden inside the client logic — every one of them is a named,
dated comment at its call site (`devAuthToken.ts`, `devContentSeed.ts`, `ContentAccessGrantImpl`'s
own header), specifically so removing them later is a deletion, not an archaeology project.

---

## 8. The parts that are already the final design, not a stand-in

Worth being explicit about, since so much of the above is scaffolding: these are not temporary.

- **Whole-book decrypt into RAM, never to disk.** `content-provider.ts`'s frozen contract, and the
  reason `MAX_DECRYPTED_BYTES` (25 MB) exists as a hard budget.
- **RSA-OAEP-256 device-key wrapping.** The mechanics — generate a device keypair once, send the
  raw SPKI public key, receive a BEK wrapped to it, unwrap with the device private key — are the
  real, agreed design. Only the *key being wrapped* (`MOCK_BEK`) is a stand-in.
- **The revocation channel.** `B6` is closed for real: the backend writes `downloads.is_valid`
  directly (no separate change-feed), `sync/offlineLock.ts` diffs it on every pull, and
  `contentStore.invalidateLicence()` strips the licence + BEK on revocation while leaving
  ciphertext on disk for a possible re-attach. This is the shipped mechanism, not a placeholder.
- **The 4-day offline cap**, computed at open-time rather than download-time — designed to survive
  a real due-date landing later without a rewrite (§6).
- **Elite is genuinely memory-only.** `isElite(pkg)` gates every keychain touch in
  `contentStore.ts`; an Elite package's BEK is never written to the keychain, and its ciphertext
  is never written to disk, in either the current stand-in backend or the eventual real one.

---

## 9. Open items that block the "planned" column from becoming real, in one place

Full detail and owners live in `CONTRACT_ALIGNMENT.md`; this is just the map of which gap in the
table above each one closes:

| Finding | Closes which gap |
| --- | --- |
| `C6` | Real auth (needs flambeau's answer on token handoff after SAML) |
| `C3` | Real catalogue → real itemIds (unowned — not Download's, not Reader's, currently nobody's) |
| `B18` | Whether a borrow step exists at all, contract vs. reality |
| `B4` | Whether `SignedLicence` should exist, and in what shape |
| `B8` | `POST /device/register-key` — flambeau's contract doesn't have the concept the client assumed |
| `B11` | No published ceiling on book size to size `MAX_DECRYPTED_BYTES` against |

Until `C3` in particular closes, `devContentSeed.ts` / `BookListScreen.tsx`'s four hardcoded rows
are load-bearing, not incidental — there is no other way to get a `bookId` into this flow today.

---

## How the WebView Renderer Is Called

### The Final Step: Content Delivery to WebView

```
READER FLOW RECAP:
1. ReaderScreen mounts with bookId
2. prepareBook(bookId) → getFormat() → determines template
3. getReaderHtmlUri(format) → resolve bundled HTML shell
4. ReaderWebView mounts with htmlUri
5. WebView reports 'ready' (HTML loaded)
6. getBookBase64(bookId, format) → decrypt bytes → base64
7. Send command to WebView: open(base64, bookId)
8. WebView decodes base64 → plaintext → renders

CONTENT DELIVERY MECHANISM:
├─ Plaintext NEVER touches disk
├─ Plaintext → base64 encode (27.9 MB for 20 MB book)
├─ base64 string sent via bridge → injectJavaScript
├─ WebView decodes base64 → ArrayBuffer
├─ epub.js or pdf.js renders from ArrayBuffer
└─ Reader displays pages

WHY THIS DESIGN:
├─ GCM decryption guarantees integrity (tag verified)
├─ base64 transport over bridge is slow but measured
├─ Total transport: ~5% of warm open time (330ms)
├─ Remaining 93% is in Encryption's decrypt (4.9s)
├─ So fixing transport won't significantly help
└─ Only removing copies helps (design-level change)

BRIDGE PROTOCOL:
┌────────────────────────────────────────────┐
│ ReaderCommand = one of:                    │
│ - open(base64, bookId)                     │
│ - search(query)                            │
│ - navigate(target)                         │
│ - applyAppearance(readerAppearance)        │
│ etc.                                       │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ ReaderMessage = response from WebView:     │
│ - ready                                    │
│ - opened                                   │
│ - error                                    │
│ - relocated(position)                      │
│ - search results                           │
│ etc.                                       │
└────────────────────────────────────────────┘

EPUB RENDERING PATH:
1. WebView receives: {command: 'open', args: {base64Data, bookId}}
2. bridge.ts: base64ToArrayBuffer(base64Data)
3. epub.entry.ts: openEpub(arrayBuffer, bookId)
   ├─ JSZip.loadAsync(arrayBuffer) → parse EPUB structure
   ├─ epub.js Book.open(spine) → load into renderer
   ├─ readerMetrics.ts: compute line grid, font metrics
   ├─ Apply CSS stylesheet (typography + theme)
   └─ Render current chapter
4. User navigates → WebView sends onRelocated message
5. ReaderScreen.tsx receives message, updates position

PDF RENDERING PATH:
1. WebView receives: {command: 'open', args: {base64Data, bookId}}
2. bridge.ts: base64ToArrayBuffer(base64Data)
3. pdf.entry.ts: openPdf(arrayBuffer, bookId)
   ├─ pdfjs.getDocument({data: arrayBuffer}) → load document
   ├─ pdf-viewer integration (PDF.js viewer)
   ├─ Render current page
   └─ Enable navigation UI
4. User navigates → PDF.js sends onRelocated message
5. ReaderScreen.tsx receives message, updates position

SEARCH INTEGRATION:
1. ReaderScreen calls useBookSearch() hook
2. User types query
3. ReaderScreen sends: {command: 'search', args: {query}}
4. WebView runs queryIndex() (for EPUB) or PDF text search
5. Returns: SearchResults array
6. ReaderScreen displays SearchPanel with results
7. User taps result → navigate to page/location

APPEARANCE (TYPOGRAPHY, THEME):
1. Personalization/prefsStore provides SharedPrefs
2. readerAppearance.ts: toReaderAppearance(prefs)
   ├─ Resolve font faces, sizes, line heights
   ├─ Resolve colors, night mode, theme
   └─ Create ReaderAppearance payload
3. ReaderScreen sends: {command: 'applyAppearance', args: appearance}
4. WebView updates CSS + re-renders
   (Called BEFORE open, so first render uses right styles)
```

### Why WebView Bridge Architecture

```
DESIGN DECISIONS & TRADEOFFS:

1. WHOLE-FILE DECRYPT (not streaming):
   ├─ Pro: Content format routing is simple
   │       (Client picks epub.js or pdf.js)
   ├─ Con: Peak memory ~6 full-size copies resident
   ├─ Con: Can't open >25 MB books
   └─ Status: Frozen design in content-provider.ts

2. BASE64 OVER BRIDGE (not raw bytes):
   ├─ Pro: Simple, no binary serialization needed
   │       Works with JavaScript JSON serialization
   ├─ Pro: Measured: 330ms for 20 MB book (acceptable)
   ├─ Con: 27.9 MB string for 20 MB book (memory spike)
   ├─ Con: Slower than binary would be
   └─ Status: Only 5% of open time, 93% is decrypt

3. INJECTJAVASCRIPT (not WebView load state):
   ├─ Pro: Content stays in JavaScript realm
   │       epub.js and pdf.js work normally
   ├─ Pro: No platform-specific binary handling
   ├─ Con: Slower than native would be
   └─ Status: Transport already analyzed, no gain

4. DUAL TYPECHECKING (TypeScript both sides):
   ├─ One ReaderMessage enum shared between halves
   ├─ Compiler enforces message types match
   ├─ parseReaderMessage() still needed (JSON hop)
   │  (runtime typing for JSON-serialized payloads)
   ├─ Test catches if a case is added to one side
   │  but not the other (compiler + runtime check)
   └─ Status: Done 2026-08-18 (shared enum)

ALTERNATIVES NOT TAKEN:
├─ Chunk decrypt + stream
│  └─ Would need WebView chapter addressing
│     (frozen contract says whole-file only)
├─ Streaming from HTTP server
│  └─ Adds server, encryption, auth complexity
│     (solved problem: HTTP range requests + TLS)
├─ Native decryption in app
│  └─ Moves decryption outside WebView process
│     (split trust boundary, still need transport)
└─ Streaming over pipe/Unix socket
   └─ Not available on iOS; Android only
      (iOS limits what can communicate with WebView)
```

### Reader Lifecycle & Cleanup

```
MOUNT PHASE:
┌───────────────────────────────────────────┐
│ ReaderScreen.tsx useEffect                │
├───────────────────────────────────────────┤
│ 1. loadBook()                             │
│    ├─ prepareBook(bookId)                │
│    │  └─ getFormat() → determine renderer │
│    ├─ getReaderHtmlUri(format)           │
│    │  └─ resolve bundled HTML shell      │
│    └─ getBookBase64(bookId, format)      │
│       ├─ verifyReadingAccess()           │
│       ├─ getBook()                       │
│       │  ├─ contentStore.openSession()   │
│       │  └─ contentStore.decryptBook()   │
│       ├─ base64 encode                   │
│       └─ return base64 string            │
│                                           │
│ 2. Pass to ReaderWebView:                │
│    ├─ htmlUri                            │
│    ├─ base64                             │
│    └─ bookId                             │
│                                           │
│ 3. ReaderWebView mounts:                 │
│    ├─ Load HTML shell from URI           │
│    ├─ Import epub.js or pdf.js           │
│    ├─ Add JavaScript bridge stubs        │
│    └─ Report ready when loaded           │
│                                           │
│ 4. Send open command:                    │
│    ├─ {command: 'open', args: {...}}    │
│    ├─ Decode base64 in WebView           │
│    ├─ epub.js/pdf.js render content     │
│    └─ Report opened                      │
└───────────────────────────────────────────┘

ACTIVE PHASE:
├─ User navigates pages
├─ User searches (for EPUB)
├─ User changes appearance
├─ WebView sends messages back to Reader
├─ Reader updates position/bookmarks/prefs
└─ All persisted via sync system

UNMOUNT PHASE:
┌───────────────────────────────────────────┐
│ ReaderScreen unmount effect               │
├───────────────────────────────────────────┤
│ closeBook(bookId)                         │
│  └─ contentStore.close(bookId)            │
│     ├─ Get SessionHandle from sessionMap  │
│     ├─ Zero plaintext buffer              │
│     │  (cryptographic cleanup)            │
│     ├─ Remove from sessionMap             │
│     ├─ Remove from packageCache           │
│     │  (both Elite and Subscription)      │
│     │                                     │
│     └─ For Subscription only:             │
│        ├─ Get BEK from keyMap/keychain    │
│        ├─ Delete BEK from keychain        │
│        └─ Delete BEK from keyMap          │
│                                           │
│ Result:                                   │
│ ├─ Plaintext zeroed (not on disk)        │
│ ├─ Ciphertext stays on disk (Subscription)
│ ├─ BEK cache cleared (can re-unwrap)      │
│ └─ No hanging references to book          │
└───────────────────────────────────────────┘

KNOWN ISSUE #1 (CLAUDE.md):
├─ close() unconditionally deletes from packageCache
├─ For Elite, that's the ONLY copy (memory-only)
├─ After close(), Elite book cannot be reopened
│  (cache miss → loadPersisted fails → no disk copy)
├─ Expected behavior: close() should be reversible
├─ Real behavior: close() is terminal for Elite
└─ Status: Deferred pending contract clarification
```

---

## Testing & Verification Strategy

```
UNIT TEST COVERAGE:
├─ contentStore.ts
│  ├─ store() with various package types
│  ├─ decryptBook() with real RSA-OAEP-256
│  ├─ License expiry checks
│  └─ Offline revocation detection
│
├─ deviceKeypair.ts
│  ├─ Device key generation
│  ├─ Fingerprint computation
│  └─ RSA-OAEP-256 unwrap (end-to-end)
│
├─ aesGcm.ts
│  ├─ AES-256-GCM decrypt
│  ├─ Tag verification (success + failure)
│  └─ Nonce extraction
│
├─ licenseCheck.ts
│  ├─ Online license check
│  ├─ Offline fallback
│  ├─ Revocation detection
│  └─ Expiry computation
│
└─ openBook.ts / downloadManager.ts
   ├─ End-to-end open (new book)
   ├─ End-to-end download
   ├─ Reopen from disk
   └─ Error cases

INTEGRATION TEST COVERAGE:
├─ Real backend (tf_reader_backend_temp) calls
├─ Real device key wrapping/unwrapping
├─ Real AES-GCM decryption
├─ Real storage persistence (iOS/Android)
├─ Real keychain operations
└─ Real WiFi + offline scenarios

ON-DEVICE TESTING:
├─ All scenarios exercised on simulator
├─ PDF and EPUB renderers both tested
├─ Warm opens (cached) vs cold opens (disk)
├─ Download + offline reopen
├─ License expiry (4-day cap)
├─ Revocation (is_valid = false)
└─ Peak memory measurement (READER_MEASUREMENTS.md)

WHAT TO TEST BEFORE SHIPPING:
├─ New book open (STREAM intent)
├─ Download (DOWNLOAD intent) → disk
├─ Reopen from disk (warm + cold)
├─ Offline fallback (network down)
├─ License revocation (is_valid flipped)
├─ License expiry (4-day cap)
├─ Keychain operations (iOS + Android)
├─ Both EPUB and PDF renderers
└─ Search (EPUB only, not PDF)
```

---
