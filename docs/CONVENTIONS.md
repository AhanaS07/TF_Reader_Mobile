# Component conventions — team1

What every shared component in `src/components/` must look like. These are the rules a PR is
checked against. They expand the three rules in the [README](../README.md#structure), which stay
authoritative. Where this file and the Week 1 Foundation Specification disagree, the
Specification wins.

## Before you start: two things aren't wired yet

Both are fixed by P0-1 (Expo install).

- **`@theme/*` aliases are editor-only.** `jsconfig.json` has no matching Babel or Metro config,
  so the alias resolves in your editor and fails in the bundler. Use a relative path for now:
  `import { colors } from '../../theme/tokens'`.
- **`prop-types` isn't installed.** Write the `propTypes` block anyway. It is inert until the
  package lands, then works with no edit.

Inter isn't registered with Expo either, which is why §5 says never to set `fontFamily`.

## 1. Folder structure

One component, one folder, three files. `PascalCase` for both folder and file.

```
src/components/ComponentName/
├── ComponentName.jsx           the component
├── ComponentName.gallery.jsx   its State Gallery entry (§9)
└── index.js                    re-export only
```

`index.js` stays two lines:

```js
export { default } from './ComponentName';
export { default as ComponentName } from './ComponentName';
```

Import the folder, never the file inside it. That indirection lets a component be split up later
without touching a single caller.

```js
import { ComponentName } from '@components/ComponentName';              // yes
import ComponentName from '@components/ComponentName/ComponentName';    // no
```

A piece used by exactly one component lives beside it (`ComponentName.Row.jsx`) and is not
exported from `index.js`. When a second component needs it, it gets its own folder (§7).

## 2. Every component has three things

All three land in the same PR. Two out of three is incomplete.

- **JSDoc `@typedef` for the props.** This is what `checkJs` reads, and the only type checking
  the project has.
- **A `propTypes` block.** Runtime warnings in dev. It duplicates the JSDoc on purpose: one
  catches mistakes as you type, the other when the app runs. Use `oneOf` for `variant` and
  `state` so a bad value warns instead of rendering unstyled.
- **A gallery entry** covering every variant and state (§6, §9).

Illustrative only — `StatusPill` is not an agreed component (§10):

```jsx
import PropTypes from 'prop-types';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@theme/tokens';

/**
 * @typedef {object} StatusPillProps
 * @property {string} label                        Text inside the pill.
 * @property {'subscription'|'elite'} variant      Which access tier this represents.
 * @property {'idle'|'pending'} [state]            Defaults to 'idle'.
 * @property {() => void} [onPress]                Omit for a non-interactive pill.
 */

/** @param {StatusPillProps} props */
export default function StatusPill({ label, variant, state = 'idle' }) {
  return (
    <View style={[styles.pill, styles[variant], state === 'pending' && styles.pending]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

StatusPill.propTypes = {
  label: PropTypes.string.isRequired,
  variant: PropTypes.oneOf(['subscription', 'elite']).isRequired,
  state: PropTypes.oneOf(['idle', 'pending']),
  onPress: PropTypes.func,
};

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  subscription: { backgroundColor: colors.subscription },
  elite: { backgroundColor: colors.elite },
  pending: { backgroundColor: colors.wait },
  label: { ...typography.smallLabel, color: colors.surface },
});
```

## 3. Props in, callbacks out

A component receives data through props and reports events through callbacks. It does not know
where the data came from or what happens next.

| A component must not | Who does it instead |
|---|---|
| Fetch data | `src/adapters/` |
| Call navigation | the screen, via an `on<Event>` callback |
| Import a Zustand store | the screen reads it and passes props down |
| Import an adapter | `src/screens/` |
| Compute access permissions or business logic | `src/access/resolveAccess` **only** |

Be strictest about the last one. Design Spec §5.1: *the UI must never calculate access rights.*
A component is told what to show. It never derives that from a user, an entitlement or a date.

```jsx
// no — computes access, reads a store, navigates
const { user } = useSessionStore();
if (user.tier === 'elite' || item.openAccess) navigation.navigate('Reader');

// yes — told what to show, reports what happened
<AccessAction state={access.state} onPress={onRequestAccess} />
```

Fine inside a component: local UI state (an expanded row, an animation, a controlled input),
layout measurement, and pure formatting of props. The test is that the same props always render
the same thing.

## 4. Naming

**`variant`** for visual differences (tier colour, emphasis, size). Always a `oneOf` union, never
a set of booleans. Two booleans allow four combinations, two of them nonsense.

```js
variant: PropTypes.oneOf(['subscription', 'elite'])          // yes
isElite: PropTypes.bool, isSubscription: PropTypes.bool      // no
```

**`state`** for lifecycle: `'loading'`, `'empty'`, `'error'`, `'offline'`, `'idle'`. Also a union,
and also a prop. A component is told it is loading, it does not decide. That is what makes every
state reviewable in the gallery. Keep the two axes separate: never `variant="elite-loading"`.

**`on<Event>`** for callbacks, named for what happened rather than what the caller should do.
`onRetry` lets a caller retry, log or ignore. `navigateToDetail` has already decided.

```js
onPress, onRetry, onDismiss, onSelectInstitution     // yes
handleClick, pressCallback, navigateToDetail         // no
```

Booleans read as statements: `disabled`, `selected`, `expanded`, not `isDisabled`. Prefer `label`
and `title` over `text`. `institution` for the thing, `institutionId` for its identifier.

## 5. No raw values

Every colour, font size, weight, line height, spacing step, radius and shadow comes from
[`src/theme/tokens.js`](../src/theme/tokens.js). A raw value in `src/components/` or
`src/screens/` fails review.

```js
padding: 16, borderRadius: 8, color: '#1A1A2E', fontSize: 15      // no
padding: spacing.md, borderRadius: radius.card, ...typography.body // yes
```

- **Spread typography whole.** `typography.body.fontSize` next to your own `lineHeight` is a raw
  value wearing a token's clothes.
- **Spread elevation whole.** A subset gives you a card that lifts on one platform only.
- **Never set `fontFamily`.** Inter isn't registered yet, and a bare `fontFamily: 'Inter'` renders
  nothing on Android. The family is applied once, globally, by the loader.
- **If the token you need doesn't exist, stop.** Don't add a value to unblock yourself. The
  Specification is amended first, then the token, then your component.

The mechanical version: no `#` and no bare number in a `StyleSheet`. Layout primitives are the
exception, since they're structure rather than design: `flex`, `flexDirection`, `alignItems`,
`borderWidth: 1`, `opacity`, percentage widths.

## 6. Design every state up front

Loading, empty, error and offline are part of the first implementation, not follow-up work.
Retrofitting a state changes the prop signature after callers exist, so every caller changes too.
And the skipped states are exactly the ones users hit on a bad connection.

Decide before you write:

- No data yet? (empty is not loading)
- In flight? (skeleton at the real content's dimensions, so nothing jumps)
- Failed? (retryable — does it need `onRetry`?)
- Offline? (different from failed: it resolves itself)
- Disabled, selected, pressed?
- Overflowing text, a long institution name, a missing optional field?

Each one becomes a `state` value (§4) and appears in the gallery (§9). If a state is genuinely
impossible, say so in the JSDoc so the next person sees it was a decision.

## 7. Shared components live in one place

`src/components/`. Not in a screen folder, not duplicated "just for now".

A feature may not introduce a component. If a screen needs something the library lacks, it is
added *to the library* and reviewed by that component's original author. The rule being protected
is one implementation, one location. Two copies of a card diverge within a week, and then a token
change fixes one of them.

A screen folder holds that screen's own layout and composition. Anything another screen could
plausibly want does not belong there.

Extending someone else's component with a new variant, state or optional prop is the normal path,
as a PR with the author as reviewer. Copying the file to change one thing is not.

## 8. Presentational and reusable

§3–§7 add up to this: a component is a pure function of its props. The working test is whether it
renders in the gallery with nothing but hardcoded props. No provider, no store, no mock network,
no navigation container.

- **No default that hides a decision.** Defaulting `state` to `'idle'` is fine. Defaulting `label`
  to `'Untitled'` buries a bug the caller should have heard about.
- **Layout belongs to the caller.** A component sizes and pads itself but sets no outer `margin`,
  `width` or absolute position. A component with its own `marginBottom` can't be reused in a row.

## 9. The State Gallery

`src/gallery/` is the visual review surface: every component, every variant, every state, side by
side, from static props. It is how a component gets reviewed without building a feature to reach
it, and how a token change is checked across the whole library at once. It is dev tooling and
never a user-reachable route.

Each component ships its own `ComponentName.gallery.jsx` (§1), so the entry moves with the
component instead of going stale in a central registry.

An entry shows every variant at every state it supports, the interactive states, and the awkward
content: longest realistic string, missing optional fields, smallest data. Wire callbacks to
something harmless and visible, never to navigation or a store. Static props only — a gallery
entry that fetches has broken §3 on the component's behalf.

A component isn't done until its gallery entry renders every state it claims to support.

## 10. No speculative components

A shared component is added when the Specification or the team agrees it is needed, not because
it looks useful. One built ahead of a real caller gets designed against an imagined use, and the
first real screen either bends around it or rewrites it.

So: a real caller, or an explicit line in the Specification. The same applies inside a component.
No variant without something rendering it, no prop without a caller passing it. Unused variants
are untested variants. If you think the library is missing something, raise it before building it.

## Before you open the PR

On top of the repo-wide list in the [README](../README.md#before-every-pr):

- [ ] Folder is `ComponentName/` with `.jsx`, `.gallery.jsx`, `index.js` (§1)
- [ ] JSDoc `@typedef` and `propTypes` both present and agreeing (§2)
- [ ] No fetch, navigation, store, adapter or access logic (§3)
- [ ] `variant`/`state` are `oneOf` unions; callbacks are `on<Event>` (§4)
- [ ] No raw hexes or bare numbers; typography and elevation spread whole (§5)
- [ ] Loading, empty, error, offline all considered, and documented if excluded (§6)
- [ ] Nothing duplicated into a screen folder (§7)
- [ ] Renders in the gallery with hardcoded props and no providers (§8)
- [ ] Gallery covers every variant × state, plus overflow and missing fields (§9)
- [ ] Every variant and prop has a real caller (§10)

If you wrote the component being extended, you are a required reviewer (§7).

## Still open

Not agreed yet. Raise these rather than setting a precedent alone.

| Question | Why it matters |
|---|---|
| Accessibility baseline: required `accessibilityRole`/`accessibilityLabel`, minimum touch target | Far cheaper to agree now than to retrofit across a finished library |
| What gets a test, and does a gallery entry substitute for one? | `jest-expo` is configured but nothing is installed, so there's no precedent either way |
| Dark mode | `tokens.js` has no scheme dimension. Adding one later touches every component |
| Where `/gallery` mounts, and what gates it in a release build | It must not be user-reachable (§9), and nothing enforces that |
