# `useReduceMotion.ts` vs. `useAppearanceEnv.ts` — resolved, no code change

**From:** Accessibility (Hruthik). **Date:** 2026-09-11. **Status: CLOSED — decided against the
refactor**, after Ahana caught a real error in this doc's first draft. Read this as the record of
that correction, not a to-do list.

## What this doc originally claimed (wrong)

The first version of this handoff said `useAppearanceEnv.ts` (Reader, Ahana's) "independently
re-implements the same OS-subscribe + `resolveReduceMotion` logic" as `useReduceMotion.ts`
(Accessibility, this file's), and suggested Ahana swap her hook to call this one instead.

**That premise was wrong, and the suggested swap would have introduced a real bug, not just
churn:**

- `useAppearanceEnv.ts` never calls `resolveReduceMotion()`. It only exposes the *raw* OS boolean
  (`AccessibilityInfo.isReduceMotionEnabled()` seed + `reduceMotionChanged` listener) as
  `AppearanceEnv.osReduceMotionEnabled` — confirmed by reading the file: `readEnv()` just threads
  the raw signal through, no resolve call anywhere in it.
- The actual resolve against the stored tri-state preference happens exactly once, downstream, in
  `src/features/personalization/readerAppearance.ts:266` —
  `resolveReduceMotion(display.reduceMotion, env.osReduceMotionEnabled)` — fed by `ReaderScreen`'s
  own already-existing `prefsStore` subscription for `display`.
- `useReduceMotion.ts` (this file) does its own independent `prefsStore` read/subscribe *and*
  resolve, producing a final answer for a different consumer (the settings-panel caption). It's a
  different layer of the same pipeline, not a copy of the same layer.
- Swapping `useAppearanceEnv`'s raw signal for this hook's already-resolved output would have fed
  an already-resolved boolean into `resolveReduceMotion` a **second time** (double-resolution),
  and added a **second, independent `prefsStore` subscription** inside Reader purely to re-derive
  one field the existing subscription already produces — the "second cache that can silently
  diverge" pattern this codebase already deleted once for reading progress
  (`sessionProgress.ts`, per `ReaderRouteScreen`'s own history). It happened to not visibly
  misbehave only because `resolveReduceMotion` ignores its second argument whenever the preference
  isn't `'system'`.

## The actual overlap, and the decision on it

The only real overlap between the two hooks is ~10–15 lines of `AccessibilityInfo` seed/listener
boilerplate — not "the same logic." A follow-up plan proposed extracting that into a shared
`src/shared/osReduceMotion.ts` → `useOsReduceMotionEnabled()`, with both hooks wrapping it (this
version is technically safe — it doesn't touch either hook's resolve step).

**Decided against, by Accessibility (this file's owner), 2026-09-11:**

- The saved code is smaller than most style guides would call a real duplication problem.
- The cost is a new shared module plus a cross-team edit to this file, for that small a save —
  real coordination overhead for a double-digit line count.
- This repo's own stated bias is explicit here: prefer duplicated lines over a premature
  abstraction. Two hooks that share a listener shape but return genuinely different things (raw
  signal vs. a fully-resolved preference) is coincidental overlap, not a shared concept straining
  to get out.

**Revisit if** a third consumer of the raw OS signal shows up — that's the point where the
extraction stops being premature.

## What's still open, unrelated to this

`CLAUDE.md` L127 (root) still says *"why `reduceMotion` stays unconsumed by both shells"* — stale
since `epub.entry.ts` started consuming it 2026-09-08. Ahana owns root/shared docs as lead; still
just a flag, not something this file's owner should edit.
