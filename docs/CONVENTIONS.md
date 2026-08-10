# Component conventions — team1

Rules for every shared component in `src/components/`. A PR is checked against these.

Two things are not wired up yet:

- `@theme/*` aliases work in the editor but not in the bundler. Use a relative path for now:
  `import { colors } from '../../theme/tokens'`.
- `prop-types` is not installed. Write the `propTypes` block anyway; it starts working when the
  package lands.

## 1. Folder structure

One component, one folder, three files. `PascalCase` for folder and file.

```
src/components/ComponentName/
├── ComponentName.jsx           the component
├── ComponentName.gallery.jsx   its gallery entry
└── index.js                    re-export only
```

`index.js` stays two lines:

```js
export { default } from './ComponentName';
export { default as ComponentName } from './ComponentName';
```

Import the folder, not the file inside it:

```js
import { ComponentName } from '@components/ComponentName';              // yes
import ComponentName from '@components/ComponentName/ComponentName';    // no
```

A part used by only one component sits beside it (`ComponentName.Row.jsx`) and is not exported
from `index.js`. When a second component needs it, give it its own folder.

## 2. Every component needs three things

All three in the same PR.

- A JSDoc `@typedef` for the props.
- A `propTypes` block, using `oneOf` for `variant` and `state`.
- A gallery entry covering every variant and state.

```jsx
import PropTypes from 'prop-types';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@theme/tokens';

/**
 * @typedef {object} StatusPillProps
 * @property {string} label                    Text inside the pill.
 * @property {'subscription'|'elite'} variant  Access tier this represents.
 * @property {'idle'|'pending'} [state]        Defaults to 'idle'.
 * @property {() => void} [onPress]            Omit for a non-interactive pill.
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

A component takes data through props and reports events through callbacks.

| A component must not | Who does it instead |
|---|---|
| Fetch data | `src/adapters/` |
| Call navigation | the screen, through an `on<Event>` callback |
| Import a Zustand store | the screen reads it and passes props down |
| Import an adapter | `src/screens/` |
| Compute access permissions or business logic | `src/access/resolveAccess` only |

A component is told what to show. It never derives that from a user, entitlement or date.

```jsx
// no
const { user } = useSessionStore();
if (user.tier === 'elite' || item.openAccess) navigation.navigate('Reader');

// yes
<AccessAction state={access.state} onPress={onRequestAccess} />
```

Allowed inside a component: local UI state, layout measurement, and formatting of props it was
given. The same props must always render the same thing.

## 4. Naming

`variant` for visual differences. Always a `oneOf` union, never booleans.

```js
variant: PropTypes.oneOf(['subscription', 'elite'])          // yes
isElite: PropTypes.bool, isSubscription: PropTypes.bool      // no
```

`state` for lifecycle: `'loading'`, `'empty'`, `'error'`, `'offline'`, `'idle'`. Also a union, and
passed in as a prop rather than held internally. Keep the axes separate: no `variant="elite-loading"`.

`on<Event>` for callbacks, named for what happened rather than what should follow.

```js
onPress, onRetry, onDismiss, onSelectInstitution     // yes
handleClick, pressCallback, navigateToDetail         // no
```

Booleans read as statements: `disabled`, `selected`, `expanded`. `institution` for the object,
`institutionId` for the id. Prefer `label` and `title` over `text`.

## 5. No raw values

Every colour, font size, weight, line height, spacing step, radius and shadow comes from
`src/theme/tokens.js`.

```js
padding: 16, borderRadius: 8, color: '#1A1A2E', fontSize: 15       // no
padding: spacing.md, borderRadius: radius.card, ...typography.body  // yes
```

- Spread `typography` and `elevation` whole. A subset of either is a raw value in disguise.
- Never set `fontFamily`. The loader applies it globally.
- If a token you need is missing, raise it. Do not add one to unblock yourself.

No `#` and no bare number in a `StyleSheet`. Layout primitives are the exception: `flex`,
`flexDirection`, `alignItems`, `borderWidth: 1`, `opacity`, percentage widths.

## 6. Design every state up front

Loading, empty, error and offline belong in the first implementation. Adding one later changes the
prop signature, so every caller changes too.

Decide before writing:

- No data yet? Empty is not loading.
- In flight? Skeleton at the real content's dimensions so nothing jumps.
- Failed? Does it need `onRetry`?
- Offline? Different from failed, since it resolves itself.
- Disabled, selected, pressed?
- Overflowing text, long names, missing optional fields?

Each becomes a `state` value and appears in the gallery. If a state is impossible, say so in the
JSDoc.

## 7. Shared components live in one place

`src/components/`. Never a copy inside a screen or feature folder.

A feature may not introduce a component. If a screen needs something the library lacks, add it to
the library, reviewed by that component's author. A screen folder holds only its own layout and
composition.

Extending a component with a new variant, state or optional prop is the normal path. Copying the
file to change one thing is not.

## 8. Presentational and reusable

A component is a pure function of its props. The test: it renders in the gallery with hardcoded
props and no provider, store, network or navigation container.

- No default that hides a decision. Defaulting `state` is fine; defaulting `label` hides a bug.
- Layout belongs to the caller. A component pads itself but sets no outer `margin`, `width` or
  absolute position.

## 9. The State Gallery

`src/gallery/` renders every component, variant and state side by side from static props. It is
dev tooling and never a user-reachable route.

Each component ships its own `ComponentName.gallery.jsx` so the entry moves with the component.

An entry covers every variant at every state, the interactive states, and awkward content: longest
realistic string, missing fields, smallest data. Wire callbacks to something harmless, never to
navigation or a store. Static props only.

A component is not done until its gallery entry renders every state it claims to support.

## 10. No speculative components

Add a shared component when it is agreed to be needed, not because it looks useful. A real caller
or an explicit requirement. Same inside a component: no variant without something rendering it, no
prop without a caller passing it. If the library is missing something, raise it before building it.

## PR checklist

- [ ] Folder is `ComponentName/` with `.jsx`, `.gallery.jsx`, `index.js`
- [ ] JSDoc `@typedef` and `propTypes` both present and agreeing
- [ ] No fetch, navigation, store, adapter or access logic
- [ ] `variant`/`state` are `oneOf` unions; callbacks are `on<Event>`
- [ ] No raw hexes or bare numbers; typography and elevation spread whole
- [ ] Loading, empty, error and offline handled, or documented as excluded
- [ ] Nothing duplicated into a screen folder
- [ ] Renders in the gallery with hardcoded props and no providers
- [ ] Gallery covers every variant × state, plus overflow and missing fields
- [ ] Every variant and prop has a real caller

If you wrote the component being extended, you are a required reviewer.

## Open questions

- Accessibility baseline: required `accessibilityRole`/`accessibilityLabel`, minimum touch target.
- What gets a test, and whether a gallery entry substitutes for one.
- Dark mode. `tokens.js` has no scheme dimension, so adding one later touches every component.
- Where `/gallery` mounts, and what keeps it out of a release build.
