// src/features/personalization/prefsOptions.ts
// The pickable values for the Theme and Font sections of the reader preferences
// screen, as data rather than as JSX.
//
// WHY A SEPARATE FILE. Both lists are PROVISIONAL (see below), so they will
// change once Hruthik signs off. Keeping them out of the section components
// means that change is one edit to a labelled array, not a hunt through render
// code — and it is reviewable on its own.
//
// TabItem, NOT A LOCAL SHAPE. `Tabs` is the control both sections render, and
// CONVENTIONS §2 says to import the type rather than retype it. Anything in
// these arrays is therefore already the shape the control accepts, and `id` is
// the value written to the store while `label` is the only thing on screen.
import type { TabItem } from '@components/Tabs';
import type { LayoutPrefs, Theme } from '@/shared/contracts';

// ─── Theme ───────────────────────────────────────────────────────────────────

// `id` is typed as `Theme` rather than `string`, so a typo or a renamed union
// member is a compile error here instead of a value the reader silently cannot
// apply. `satisfies` keeps that check while still handing `Tabs` a TabItem[].
type ThemeOption = TabItem & { id: Theme };

// FOUR OF THE UNION'S FIVE MEMBERS. `highContrast` is deliberately absent:
// accessibility is Hruthik's surface, `AccessibilityPrefs.highContrast` is the
// flag that pairs with it, and prefs.ts marks that whole interface "PROVISIONAL
// — NEEDS HRUTHIK'S SIGN-OFF" because folding it in moved a boundary that was
// his. Offering the theme variant here would be this screen claiming ownership
// of a decision that has not been made.
//
// A STORED 'highContrast' IS THEREFORE UNMATCHED, AND THAT IS HANDLED RATHER
// THAN PREVENTED. Prefs are a per-user singleton synced LWW across devices, so
// the value can arrive from somewhere this screen does not control. `Tabs`
// renders no active segment when `activeId` matches nothing, which is the right
// answer — a wrong highlight is worse than no highlight — and the sections say
// so out loud rather than leaving the control looking broken. See
// ReaderPreferencesScreen.ThemeSection.tsx.
export const THEME_OPTIONS = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'system', label: 'System' },
] as const satisfies readonly ThemeOption[];

// ─── Font family ─────────────────────────────────────────────────────────────

// PROVISIONAL — PENDING HRUTHIK'S SIGN-OFF, and more provisional than the theme
// list above. These seven come from the t4targaryen integration contract as
// relayed in the Week 3 plan; they are NOT ratified in `prefs.ts`, which types
// `FontPrefs.family` as an open `string` and offers only 'Georgia' and 'system'
// as comment examples. So this array is the only place in the repo that names
// them, and it is a starting point rather than a product requirement. Keshav
// sent the confirmation question on Monday; expect the strings to be renamed.
//
// `id` STAYS `string`, MATCHING THE CONTRACT. `FontPrefs.family` is a plain
// string precisely because the reader accepts faces this list does not know
// about, including a user-supplied file via `customFontUri`. Narrowing it to a
// union here would be this screen inventing a constraint the contract does not
// have — and it would break the moment a stored value came from outside the
// list, which is exactly the case the sections already handle.
//
// 'system' IS LOWERCASE ON PURPOSE. It is the one value the contract does fix:
// `DEFAULT_PREFS.font.family` is `'system'`. The label is capitalised for
// display; the stored id is not.
//
// NOTHING IS PREVIEWED IN ITS OWN FACE. CONVENTIONS §5 — "Never set
// fontFamily. The loader applies it globally" — and none of these six faces is
// installed in this app anyway. They are labels naming a choice the READER
// applies to book content; they never restyle our own chrome.
export const FONT_FAMILY_OPTIONS = [
  { id: 'system', label: 'System' },
  { id: 'Inter', label: 'Inter' },
  { id: 'Poppins', label: 'Poppins' },
  { id: 'Roboto', label: 'Roboto' },
  { id: 'Merriweather', label: 'Merriweather' },
  { id: 'Lora', label: 'Lora' },
  { id: 'Montserrat', label: 'Montserrat' },
] as const satisfies readonly TabItem[];

// ─── Layout ──────────────────────────────────────────────────────────────────

// `id` typed against the contract so a rename to the union member is a compile
// error here instead of a silent mismatch with the epub.js rendition API.
type FlowOption = TabItem & { id: LayoutPrefs['flow'] };
type SpreadOption = TabItem & { id: LayoutPrefs['spread'] };

export const FLOW_OPTIONS = [
  { id: 'paginated', label: 'Paginated' },
  { id: 'scrolled-doc', label: 'Scrolled' },
] as const satisfies readonly FlowOption[];

export const SPREAD_OPTIONS = [
  { id: 'single', label: 'Single' },
  { id: 'double', label: 'Double' },
] as const satisfies readonly SpreadOption[];

// ─── Typography — text size ─────────────────────────────────────────────────

// SIX FIXED PRESETS, NOT A FREE SLIDER — the Week 3 plan is explicit on this
// point alone among the four Typography controls. `Tabs` takes a string `id`,
// so each preset's point size is stored as its string form and parsed back to
// a number at the call site, the same way `LayoutSection` casts a `Tabs`
// `onChange` id back to its contract union.
export const TEXT_SIZE_OPTIONS = [
  { id: '14', label: '14pt' },
  { id: '16', label: '16pt' },
  { id: '18', label: '18pt' },
  { id: '20', label: '20pt' },
  { id: '22', label: '22pt' },
  { id: '24', label: '24pt' },
] as const satisfies readonly TabItem[];
