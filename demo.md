# Demo script — Encryption + Download (CAP-7 D2/D4)

Everything below was actually run, end-to-end, on a real Android emulator against the real
mock-backend, immediately before writing this doc. Every log line under "Expected output" is
copy-pasted from that real run, not invented. If your run's output differs in the specific
IDs/timestamps/fingerprints, that's fine (they're randomly generated per run); the *shape* of
each line, and the "Correctly rejected" / "matches original: true" lines, should match exactly.

This covers everything built so far:

**Encryption**
- Real on-device RSA-2048 device keypair generation, private key stored in the Keychain
- Real AES-256-GCM encrypt → decrypt round trip
- BEK wrap/unwrap under the device's RSA key
- Tamper detection (corrupt one byte of ciphertext, GCM auth tag catches it)
- Where the encrypted book actually lives on disk, and proof it's not plaintext

**Download skeleton**
- Permission check, storage check, 5-book limit
- Resolve encrypted asset by Book ID; hand bytes to `store()` (never persist plaintext)
- Device-key provisioning: generate the keypair, store the private key, stub public-key
  registration against a real backend call

There's no UI screen for any of this yet (by design — see
`docs/superpowers/specs/2026-08-13-download-devicekey-skeleton-design.md` and `BuildPlan.md`;
neither `downloadBook`/`provisionDeviceKey` nor the raw `aesGcm`/`deviceKeypair` functions have a
caller in the app yet). The demo drives the real functions directly from a temporary hook in
`App.tsx`, on a real device/emulator, against the real `mock-backend`. Same "temporarily wire it
in, run it, capture the result, revert it" pattern already used elsewhere in this codebase (see
`docs/build-status.md` and `ahana.md`) — nothing here is faked, and nothing gets left behind
afterward.

**Why not a live Jest test instead?** Tried it first. Jest's environment doesn't provide a
working `fetch` for real outbound network calls in this project's setup — a real HTTP request
inside Jest resolves to a `Response`-shaped object with `status: undefined` and no body,
silently, rather than throwing. Only the real React Native runtime (Hermes, on an actual
simulator/emulator) has a `fetch` that actually reaches a server. That's why this runs the app
for real instead of a test file. (The encryption half doesn't need network at all and *would*
work fine under Jest — `aesGcm.test.ts`, `deviceKeypair.test.ts` already cover it that way — but
running everything through the one on-device script keeps the demo to a single script and a
single "revert this file" step at the end.)

---

## 0. Before the demo — one-time setup (do this the night before, not live)

1. **Start the mock-backend** (a local throwaway Express server — device-key registration,
   content-licence, signed-url routes):
   ```bash
   cd mock-backend
   npm install   # first time only
   npm start
   ```
   Confirm it's up:
   ```bash
   curl http://localhost:4000/
   ```
   Expected:
   ```json
   {"ok":true,"message":"mock-backend running","routes":["POST /device/register-key","GET  /books/:id/content-licence","GET  /books/:id/signed-url","POST /books/:id/return","POST /books/:id/seat/join","POST /books/:id/seat/leave"]}
   ```
   Leave this terminal running for the whole demo.

2. **Boot a simulator/emulator and get the dev client running**, from the repo root:
   ```bash
   npx expo start --dev-client --port 8081   # in one terminal, leave running
   npx expo run:android                       # or: npx expo run:ios
   ```
   Confirm the app launches and shows the Reader screen ("TF Reader" header, "Chapter One:
   Opening the Book"). If it does, the toolchain, Metro, and the dev client are all fine —
   don't touch this part again before the demo.

   **Gotchas I actually hit doing this myself, both worth knowing:**
   - If you boot a *fresh* emulator instance (not one that was already running when you last
     did `expo run:android`), `localhost` inside the emulator means the emulator itself, not
     your machine — the dev client fails with "Failed to connect to localhost/127.0.0.1:8082".
     Fix: `adb reverse tcp:8082 tcp:8082` before opening the dev-client link.
   - If you connect the dev client via a `localhost:...` URL (as opposed to your machine's LAN
     IP), `src/features/download/config.ts`'s host-resolution logic will *also* resolve the
     mock-backend's address to `localhost:4000` — which needs its OWN forward:
     `adb reverse tcp:4000 tcp:4000`. Forgetting this is exactly what makes
     `provisionDeviceKey()`/`downloadBook()` fail with `REGISTRATION_FAILED`/
     `LICENCE_FETCH_FAILED` even though `mock-backend` is definitely running — the emulator
     just can't reach it yet. Do both `adb reverse` calls up front and this never comes up.

3. **Run the full test suite once**, so you have a green baseline to fall back on if anything
   about the live device demo misbehaves under demo-day network flakiness:
   ```bash
   npm run typecheck && npm run lint && npm test
   ```
   Expected: 0 typecheck errors, 0 lint errors/warnings, all suites passing (31 suites / 276
   tests as of this writing).

---

## 1. The live on-device script

This is the centerpiece: real crypto, a real device keypair, a real tamper-detection failure,
real `provisionDeviceKey()`/`downloadBook()` calls hitting the real `mock-backend`, with real
SQLite writes and real Keychain calls — all in one script.

### Step 1.1 — Add the temporary demo hook

Open `App.tsx`. Add this import block right after the existing imports:

```ts
import { useEffect } from 'react';
import { randomBytes } from 'react-native-quick-crypto';
// TEMP DEMO HOOK — remove after the demo, see demo.md
import { encrypt, decrypt } from '@/features/encryption/aesGcm';
import { generateDeviceKeypair, wrapBek, unwrapBek } from '@/features/encryption/deviceKeypair';
import { contentStore } from '@/features/encryption/contentStore';
import { downloadBook, BOOK_LIMIT } from '@/features/download/downloadManager';
import { provisionDeviceKey } from '@/features/download/deviceKeyRegistration';
import { downloadTable } from '@/features/sync/repositories/downloadRepository';
import { USER_ID } from '@/features/sync/config';
```

Then add this `useEffect` as the very first line inside `export default function App() {`,
before the `return (`:

```ts
  useEffect(() => {
    void (async () => {
      try {
        // --- ENCRYPTION: round-trip + tamper detection ---
        console.log('=== [ENCRYPTION] generateDeviceKeypair() ===');
        const { publicKey } = await generateDeviceKeypair();
        console.log(publicKey.split('\n')[0]);

        const plaintext = new TextEncoder().encode('Hello from the encryption demo!');
        const bek = Uint8Array.from(randomBytes(32));

        console.log('=== [ENCRYPTION] encrypt() ===');
        const payload = await encrypt(plaintext, bek);
        console.log('cipherLength:', payload.cipherLength, 'originalLength:', payload.originalLength);

        console.log('=== [ENCRYPTION] decrypt() ===');
        const roundTripped = await decrypt(payload, bek);
        console.log('round-trip matches original:', new TextDecoder().decode(roundTripped) === 'Hello from the encryption demo!');

        console.log('=== [ENCRYPTION] wrapBek() / unwrapBek() ===');
        const wrapped = await wrapBek(bek, publicKey);
        const unwrapped = await unwrapBek(wrapped);
        console.log('unwrapped BEK matches original:', unwrapped.every((b, i) => b === bek[i]));

        console.log('=== [ENCRYPTION] tamper detection ===');
        const tampered = { ...payload, content: new Uint8Array(payload.content) };
        tampered.content[20] ^= 0xff; // flip a byte inside the ciphertext
        try {
          await decrypt(tampered, bek);
          console.log('UNEXPECTED: tampered ciphertext decrypted anyway');
        } catch (e: any) {
          console.log('Correctly rejected tampered ciphertext:', e.message ?? String(e));
        }

        // --- DOWNLOAD: provisioning + skeleton + 5-book limit ---
        console.log('=== [DOWNLOAD] provisionDeviceKey() ===');
        const reg = await provisionDeviceKey();
        console.log(JSON.stringify(reg));

        console.log('=== [DOWNLOAD] downloadBook("demo-book-live-001") ===');
        await downloadBook('demo-book-live-001');
        console.log('isAvailableOffline:', await contentStore.isAvailableOffline('demo-book-live-001'));

        for (let i = 0; i < BOOK_LIMIT - 1; i++) {
          await downloadBook(`demo-book-live-limit-${i}`);
        }
        const rows = await downloadTable.listActive(USER_ID);
        console.log('Total downloaded:', rows.length);

        try {
          await downloadBook('demo-book-live-over-cap');
          console.log('UNEXPECTED: over-cap download did not throw');
        } catch (e: any) {
          console.log('Correctly rejected over cap with code:', e.code);
        }

        await downloadBook('demo-book-live-001');
        console.log('Re-download of already-downloaded book succeeded (no limit error)');
      } catch (e: any) {
        console.log('DEMO_SCRIPT_ERROR', e && e.code, e && e.message);
      }
    })();
  }, []);
```

Save. Metro Fast Refresh picks it up automatically within a few seconds — no rebuild needed,
this is pure JS. (If you don't see fresh output, force-reload the app once: on Android,
`adb shell am force-stop com.taylorandfrancis.tfreader.dev` then relaunch it.)

### Step 1.2 — Watch the Metro terminal

You should see, in order:

```
=== [ENCRYPTION] generateDeviceKeypair() ===
-----BEGIN PUBLIC KEY-----
=== [ENCRYPTION] encrypt() ===
cipherLength: 59 originalLength: 31
=== [ENCRYPTION] decrypt() ===
round-trip matches original: true
=== [ENCRYPTION] wrapBek() / unwrapBek() ===
unwrapped BEK matches original: true
=== [ENCRYPTION] tamper detection ===
Correctly rejected tampered ciphertext: Bad auth tag exception
=== [DOWNLOAD] provisionDeviceKey() ===
{"deviceId":"2dc39c63-2507-491c-ba2c-e7cb295ff3d8","publicKeyFingerprint":"fp-msrf0mfv","registeredAt":"2026-08-13T11:08:45.595Z"}
=== [DOWNLOAD] downloadBook("demo-book-live-001") ===
isAvailableOffline: true
Total downloaded: 5
Correctly rejected over cap with code: BOOK_LIMIT_REACHED
Re-download of already-downloaded book succeeded (no limit error)
```

**What to say, line by line:**

**Encryption:**
- `generateDeviceKeypair()` → **"A real RSA-2048 keypair, generated on-device. The private key
  never leaves the Keychain — this line only ever sees the public key."**
- `encrypt()` → **"Real AES-256-GCM, via the actual native crypto module, not a JS
  implementation. `cipherLength` is `originalLength + 28` — 12 bytes of nonce, 16 bytes of GCM
  auth tag, always."**
- `decrypt()` → **"Byte-for-byte round trip back to the original plaintext."**
- `wrapBek()`/`unwrapBek()` → **"The same pattern used for every real book: the content key
  (BEK) gets wrapped to the device's public key with RSA-OAEP-256, and only this device's
  private key can unwrap it back."**
- `tamper detection` → **"I flipped one bit inside the ciphertext and tried to decrypt it. AES-GCM's
  authentication tag catches it immediately — this is the whole reason we picked an AEAD
  cipher. It fails LOUDLY, never silently returns garbage."**

**Download:**
- `provisionDeviceKey()` → **"This POSTs the public key to the backend's
  `/device/register-key` — that response came back from a real HTTP call to `mock-backend`,
  not a mock."**
- `downloadBook("demo-book-live-001")` → **"Permission check → storage check → 5-book limit
  check → fetches the content-licence and the encrypted bytes from the backend → verifies the
  SHA-256 checksum → hands the ciphertext straight to `store()`. Nothing in this path ever
  touches plaintext."**
- `isAvailableOffline: true` → **"Confirms the book is genuinely persisted and retrievable —
  checks real on-disk state, not an in-memory flag."**
- `Total downloaded: 5` → **"5 distinct books — at the cap."**
- `Correctly rejected over cap with code: BOOK_LIMIT_REACHED` → **"A 6th distinct book is
  rejected before any network call — enforced atomically against a write lock so two
  concurrent downloads can't both sneak past it."**
- `Re-download of already-downloaded book succeeded` → **"Re-downloading a book you already
  have doesn't count against the limit a second time — the cap is about distinct books, not
  attempts."**

### Step 1.3 — Revert the hook

**Do this before you forget** — it's temporary instrumentation, not part of the app:

```bash
git checkout -- App.tsx
```

(Or manually delete the import block and the `useEffect` if you made other unrelated edits to
`App.tsx` you don't want to lose — check `git diff App.tsx` first either way.)

---

## 2. Show the encrypted file on disk (proof it's never plaintext)

This is the single most convincing thing you can show live, and it takes 30 seconds.

```bash
adb shell run-as com.taylorandfrancis.tfreader.dev ls -la /data/data/com.taylorandfrancis.tfreader.dev/files/tf-reader-content/
```
Expected (files from the script above):
```
-rw------- 1 u0_a197 u0_a197  252 ... demo-book-live-001.content.bin
-rw------- 1 u0_a197 u0_a197  724 ... demo-book-live-001.meta.json
```

Dump the actual bytes of the ciphertext:
```bash
adb shell run-as com.taylorandfrancis.tfreader.dev od -A x -t x1 -v /data/data/com.taylorandfrancis.tfreader.dev/files/tf-reader-content/demo-book-live-001.content.bin | head -5
```
Expected: random-looking bytes, no readable text —
```
000000 8d ab 7d c9 7d 58 b9 2c b2 b4 40 87 80 3d a7 08
000010 f6 66 70 9e 8d 27 2a 91 26 de 47 26 86 bb 7a 1b
...
```

**What to say:** *"This is the actual file on disk after `downloadBook`. It's app-private
(`0700` permissions — no other app can read it), and it's ciphertext — random bytes, not a
readable EPUB. The `.meta.json` next to it carries the wrapped key and licence, but the wrapped
key is useless without this exact device's private key sitting in the Keychain, and there is no
plaintext anywhere on disk."*

If asked "where does this path come from" — `Paths.document` (from `expo-file-system`),
app-sandboxed on both iOS and Android; `contentStore.ts`'s `STORE_DIR` just adds a
`tf-reader-content/` subfolder under it.

---

## 3. Bonus: the Reader actually decrypting real content

Not this feature (Reader is Ahana's), but it's the most visually convincing proof that the
encryption pipeline is real end-to-end, and it's already running — no setup needed. Point at
the app:

**"This text you're reading right now was encrypted on this device a few seconds ago with a
real AES-256-GCM key, stored, and decrypted back through the exact same `ContentStore` the
demo just used. It's the same pipeline, just triggered by the Reader's own seed instead of the
script."** (`src/features/reader/devContentSeed.ts`, if anyone wants to see it after.)

---

## 4. Fallback: test suite as supporting evidence

If the live device demo has any hiccup (flaky emulator, wifi, whatever) — don't panic, pivot to
this:

```bash
npm test -- aesGcm deviceKeypair contentStore download
```

Expected: all of `aesGcm.test.ts`, `deviceKeypair.test.ts` (+ `.edgecases.test.ts`),
`contentStore.test.ts` (+ `.edgecases.test.ts`), and every `src/features/download/*.test.ts`
file pass. These mock only the network layer (and, for encryption, the native crypto module —
via a manual Jest mock backed by Node's real `crypto`, so the *math* is real even under test);
everything else — real SQLite (`sql.js`), real Keychain (in-memory mock), real GCM tag
verification — is the genuine code path.

```bash
npm run typecheck && npm run lint
```
Expected: clean, 0 errors/warnings on both.

---

## 5. Anticipated questions

- **"Why no UI for any of this?"** — Scope was the skeleton/primitives (crypto round-trip,
  device-key provisioning, download's permission/storage/limit/resolve-and-store), not a
  reader or download screen. None of `downloadBook`/`provisionDeviceKey`/`encrypt`/`decrypt`
  have a UI caller yet in the app; that's next.
- **"Is the mock-backend real?"** — A real local Express server (`mock-backend/`),
  throwaway/gitignored, standing in for the real backend team's service. The wire format
  (`ContentLicenceResponse`, `DeviceKeyRegistrationRequest/Response`) is the frozen contract
  either side codes against.
- **"Is the RSA key hardware-backed (Secure Enclave / StrongBox)?"** — No, and this is a known,
  documented limitation, not glossed over: it's a software (JSI/C++) RSA implementation. The
  private key is stored in the OS keychain like any app secret, but isn't provably
  non-exportable the way a true hardware-backed key would be.
- **"Is the licence signature verified?"** — Not yet. Expiry is checked (and is real); the
  RS256 signature on the licence is a known, documented gap, not silently skipped over.
- **"What's `stub` mean for device-key registration?"** — No retry logic, no persisted
  "already registered" flag. It's a real POST that really registers the key, just without
  production hardening yet (documented explicitly in `deviceKeyRegistration.ts`'s header).
- **"Does this ever touch plaintext?"** — No, anywhere. `encrypt`/`decrypt` hold plaintext only
  in RAM; `downloadBook` only ever holds ciphertext bytes and hands them to `contentStore.store()`
  unmodified; `contentStore.ts` is the only place that ever decrypts, and only into RAM, never
  to disk (Section 2 is the live proof of that).
