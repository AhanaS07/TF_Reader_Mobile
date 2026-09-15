// Owner: Reader (Ahana).
//
// Opt-in timing/heap probes for the whole-book open path. The repo had no instrumentation at all
// before this, so the rules it follows are stated here rather than rediscovered:
//
// WHY AN ENV FLAG AND NOT __DEV__: `__DEV__` does not typecheck in this repo. tsconfig.json pins
// `types: ["jest","node"]` and nothing reachable declares `__DEV__`, so referencing it is a
// compile error. Expo's metro config inlines `EXPO_PUBLIC_`-prefixed variables into process.env,
// and @types/node types that — so this is the form that both works at runtime and compiles.
//
// WHY EVERY FUNCTION IS SYNCHRONOUS: type-aware ESLint (no-floating-promises, no-misused-promises,
// await-thenable) is enabled for src/features/reader/** only. A probe that returned a Promise would
// need a `void` or an `await` at every call site on the very path it is measuring — noise on the
// hot path, and an easy way to change the timing you are trying to observe. Keep it sync.
//
// OFF MEANS SILENT. With the flag unset every function below returns early or returns null, so no
// build — dev or release — emits anything. That is deliberate: this measures a path that holds
// decrypted licensed content, and payload sizes are the kind of thing that should not leak into
// production logs by default.

/**
 * Non-standard, Hermes-only. React Native's Performance implementation maps Hermes'
 * `hermes_heapSize` / `hermes_allocatedBytes` onto these fields; under JSC it returns an object
 * with nothing useful on it, hence the nullable members. Not in the DOM lib types, which is why
 * this is declared locally and read through the single cast in `heapUsedMb()` rather than at each
 * call site.
 */
interface HermesMemoryInfo {
  totalJSHeapSize: number | null;
  usedJSHeapSize: number | null;
}

/**
 * WRITTEN AS A LITERAL MEMBER ACCESS, DELIBERATELY — do not refactor the key into a constant.
 * Metro's env-var serializer substitutes `process.env.EXPO_PUBLIC_*` member expressions at bundle
 * time; a computed `process.env[SOME_CONST]` is not matched, so it would survive into the bundle as
 * a lookup against an object that has no such key on device. The flag would then be permanently
 * undefined and every probe below silently dead — instrumentation that looks wired and reports
 * nothing. `expo/no-dynamic-env-var` enforces this at the call sites it can see.
 */
export function isTimingEnabled(): boolean {
  return process.env.EXPO_PUBLIC_READER_TIMING === '1';
}

/**
 * Monotonic where available. `performance.now()` is immune to a wall-clock adjustment landing
 * mid-measurement; Date.now() is the fallback only because nothing guarantees `performance` on
 * every runtime this could be bundled into.
 */
export function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Used JS heap in MB, or null when the runtime does not report it (JSC, or Hermes without it). */
export function heapUsedMb(): number | null {
  if (typeof performance === 'undefined') return null;

  const memory = (performance as unknown as { memory?: HermesMemoryInfo }).memory;
  const used = memory?.usedJSHeapSize;
  if (typeof used !== 'number') return null;

  return Math.round((used / (1024 * 1024)) * 10) / 10;
}

function formatExtra(extra: Record<string, number | string> | undefined): string {
  if (!extra) return '';
  return Object.entries(extra)
    .map(([key, value]) => ` ${key}=${typeof value === 'number' ? formatNumber(value) : value}`)
    .join('');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(1);
}

function emit(line: string): void {
  // console.log is the transport on purpose: it reaches the Metro terminal, the Xcode console and
  // Safari's inspector without any extra wiring. `no-console` is not enabled in this config, and
  // adding an eslint-disable for it fails --max-warnings=0 as an unused directive.
  console.log(line);
}

/** A completed span. `startedAt` comes from `now()`. */
export function logSpan(
  label: string,
  startedAt: number,
  extra?: Record<string, number | string>
): void {
  if (!isTimingEnabled()) return;

  const ms = Math.round(now() - startedAt);
  const heap = heapUsedMb();
  const heapText = heap === null ? '' : ` heapMB=${heap.toFixed(1)}`;
  emit(`[TFPERF] ${label} ${ms}ms${heapText}${formatExtra(extra)}`);
}

/** A point in time — used for the bridge handshake, where there is no enclosing span to measure. */
export function logEvent(label: string, extra?: Record<string, number | string>): void {
  if (!isTimingEnabled()) return;

  const heap = heapUsedMb();
  const heapText = heap === null ? '' : ` heapMB=${heap.toFixed(1)}`;
  emit(`[TFPERF] ${label} at=${Math.round(now())}ms${heapText}${formatExtra(extra)}`);
}
