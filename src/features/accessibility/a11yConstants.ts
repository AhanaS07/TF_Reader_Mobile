// src/features/accessibility/a11yConstants.ts
// Owner: Accessibility (Hruthik).
//
// Shared motor/input-accessibility constants for this feature's own components.
// MIN_TOUCH_TARGET mirrors a number ReaderScreen.tsx already hand-rolls inline (its `toolbarButton`
// style: minWidth/minHeight 44, "44pt is the minimum comfortable touch target") — this is
// Accessibility's own copy for Accessibility's own controls, not an import from Reader, so each
// feature can change its number without dragging the other's along.
//
// FOCUS_RING_* back a visible focus indicator for switch-control/keyboard/external-input users —
// distinct from a11yFocus.ts's `focusOn` (screen-reader focus via
// AccessibilityInfo.setAccessibilityFocus), which already exists and is unrelated. No visual
// focus-ring pattern exists anywhere else in this codebase yet.

/** Apple HIG's "comfortable" touch target floor, in points. */
export const MIN_TOUCH_TARGET = 44;

// Two fixed colours, gated on `accessibility.display.highContrast` alone (via useHighContrast.ts)
// rather than on a resolved ColorScheme. `resolveColorScheme()` never expresses contrast — it's
// Personalization's theme, and highContrast is deliberately independent of it (readerAppearance.ts)
// — so reading colour scheme from here would pull a Reader/Personalization concern into a
// component that has no other reason to know either exists.
export const FOCUS_RING_COLOR = '#0a84ff';
export const FOCUS_RING_COLOR_HIGH_CONTRAST = '#ffd60a';
export const FOCUS_RING_WIDTH = 2;
