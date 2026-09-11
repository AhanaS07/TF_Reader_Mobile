# `useReduceMotion.ts` duplication — handoff for Ahana

**From:** Accessibility (Hruthik). **Date:** 2026-09-11. **Not applied** — this is a note about
Reader's file, not an edit to it. Per the repo's ownership rules, the actual change (if you want
it) is yours to make.

## What was found

`src/features/accessibility/useReduceMotion.ts` is headed:

```
// Owner: Accessibility (Hruthik). Consumed by Reader (Ahana).
```

That was never true. Reader doesn't import this hook anywhere. Instead,
`src/features/reader/useAppearanceEnv.ts` independently re-implements the exact same logic this
hook already provides:

- Seeds `osReduceMotionEnabled` from `AccessibilityInfo.isReduceMotionEnabled()`.
- Subscribes to `AccessibilityInfo.addEventListener('reduceMotionChanged', ...)` for live updates.
- Feeds the result, plus the stored tri-state preference, through the same frozen
  `resolveReduceMotion()` (`shared/contracts/accessibility.ts`).

Both hooks do the identical seed+subscribe+resolve dance against the identical OS API, in two
files, maintained by two people. That's the DRY violation.

## Why it happened

`useReduceMotion.ts` was introduced in commit `4dbceac` ("feat(accessibility): implement PDF
support in TTS with new test providers and hooks") — bundled into a larger feature commit rather
than built for a named call site, and never actually wired into Reader afterward. The header
comment describes the *intended* consumer, not an *actual* one.

## What we did on our side

Since Reader never called it, the hook had zero real consumers. Rather than leave it as dead code,
we gave it a genuine consumer inside our own lane: `AccessibilitySettingsPanel.tsx` now shows a
"Currently: On/Off" caption under the Reduce Motion control, visible only when the stored
preference is `'system'` (the only selection where the resolved state isn't already obvious from
the picker itself). So the hook is no longer unconsumed — just not consumed by Reader, which is
what its own header still claims.

## What's still yours to decide

`useAppearanceEnv.ts` could import `useReduceMotion` from `@/features/accessibility` and drop its
own duplicate `AccessibilityInfo` subscription, collapsing the duplication to one implementation.
We haven't made that change — it's your file, and it may not be worth the churn if
`useAppearanceEnv.ts`'s shape doesn't compose well with a hook that resolves the *stored
preference* as well as the OS signal (yours may only need the OS half, or may want to stay
independent for a reason we don't have visibility into). Your call either way; flagging it so the
duplication is at least written down somewhere.

## One more small thing while we're here

`CLAUDE.md` L127 (root) still says *"the full account, including why `reduceMotion` stays
unconsumed by both shells"* — that's stale since `epub.entry.ts` started consuming it 2026-09-08.
Since you own `shared/`/root docs as lead, flagging rather than editing it ourselves.
