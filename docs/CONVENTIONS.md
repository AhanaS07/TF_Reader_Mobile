# Component conventions — team1

Rules for every shared component in `src/components/`. A PR is checked against these.

- TypeScript is the project's source language.
- Components use `.tsx`.
- `@theme/*` aliases resolve in both the editor and the bundler.
- Import design tokens from `@theme/tokens`.
- `npm run typecheck` runs `tsc --noEmit`.

## 1. Folder structure

One component, one folder, three files. PascalCase for folder and component name.

```
src/components/ComponentName/
├── ComponentName.tsx           the component
├── ComponentName.gallery.tsx   its gallery entry
└── index.ts                    re-export only
```

`index.ts` stays two lines:

```ts
export { default } from './ComponentName';
export { default as ComponentName } from './ComponentName';
```

Import the folder, not the file inside it:

```ts
import { ComponentName } from '@components/ComponentName';              // yes
import ComponentName from '@components/ComponentName/ComponentName';    // no
```

A part used by only one component sits beside it (`ComponentName.Row.tsx`) and is not exported
from `index.ts`. When a second component needs it, give it its own folder.

## 2. Every component needs two things

Both in the same PR.

- A TypeScript type or interface for its props.
- A gallery entry covering every variant and state.

No PropTypes. No JSDoc typedefs for props — the types are the contract.

```tsx
import { StyleSheet, Text, View } from 'react-native';
import { color, radius, space, type } from '@theme/tokens';

type StatusPillVariant = 'subscription' | 'elite';
type StatusPillState = 'idle' | 'pending';

interface StatusPillProps {
  label: string;
  variant: StatusPillVariant;
  state?: StatusPillState;
  onPress?: () => void;
}

export default function StatusPill({ label, variant, state = 'idle' }: StatusPillProps) {
  return (
    <View style={[styles.pill, styles[variant], state === 'pending' && styles.pending]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  subscription: { backgroundColor: color.subscription },
  elite: { backgroundColor: color.elite },
  pending: { backgroundColor: color.wait },
  label: {
    fontWeight: type.smallLabel.weight,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.surface,
  },
});
```

Prefer string-literal unions over `string` for `variant` and `state`, so an invalid value is a
compile error.

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

```tsx
// no
const { user } = useSessionStore();
if (user.tier === 'elite' || item.openAccess) navigation.navigate('Reader');

// yes
<AccessAction state={access.state} onPress={onRequestAccess} />
```

Allowed inside a component: local UI state, layout measurement, and formatting of props it was
given. The same props must always render the same thing.

## 4. Naming

`variant` for visual differences. Always a union, never booleans.

```ts
variant: 'subscription' | 'elite';        // yes
isElite?: boolean; isSubscription?: boolean;   // no
```

`state` for lifecycle: `'loading' | 'empty' | 'error' | 'offline' | 'idle'`. Also a union, and
passed in as a prop rather than held internally. Keep the axes separate: no `variant="elite-loading"`.

`on<Event>` for callbacks, named for what happened rather than what should follow.

```ts
onPress, onRetry, onDismiss, onSelectInstitution     // yes
handleClick, pressCallback, navigateToDetail         // no
```

Booleans read as statements: `disabled`, `selected`, `expanded`. `institution` for the object,
`institutionId` for the id. Prefer `label` and `title` over `text`.

## 5. No raw values

Every colour, font size, weight, line height, spacing step, radius and shadow comes from
`src/theme/tokens.ts`. Groups are `color`, `font`, `type`, `space`, `radius`, `elevation`.

```ts
padding: 16, borderRadius: 8, color: '#1A1A2E', fontSize: 15                  // no
padding: space.md, borderRadius: radius.card, color: color.textPrimary        // yes
```

- `type` entries use `weight` / `size` / `lineHeight`. Map them onto `fontWeight` / `fontSize` /
  `lineHeight` at the call site.
- `elevation.card` is split by platform. Spread `elevation.card.ios` or `elevation.card.android`,
  never a subset of either.
- Never set `fontFamily`. The loader applies it globally.
- If a token you need is missing, raise it. Do not add one to unblock yourself.

No `#` and no bare number in a `StyleSheet`. Layout primitives are the exception: `flex`,
`flexDirection`, `alignItems`, `borderWidth: 1`, `opacity`, percentage widths.

## 6. Design every state up front

Loading, empty, error and offline belong in the first implementation. Adding one later changes the
props, so every caller changes too.

Decide before writing:

- No data yet? Empty is not loading.
- In flight? Skeleton at the real content's dimensions so nothing jumps.
- Failed? Does it need `onRetry`?
- Offline? Different from failed, since it resolves itself.
- Disabled, selected, pressed?
- Overflowing text, long names, missing optional fields?

Each becomes a `state` value and appears in the gallery. If a state is impossible, say so in a
short comment.

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

Each component ships its own `ComponentName.gallery.tsx` so the entry moves with the component.

An entry covers every variant at every state it supports, the interactive states, and awkward
content: longest realistic string, missing fields, smallest data. Wire callbacks to something
harmless, never to navigation or a store. Static props only.

A component is not done until its gallery entry renders every state it claims to support.

## 10. No speculative components

Add a shared component when it is agreed to be needed, not because it looks useful. A real caller
or an explicit requirement. Same inside a component: no variant without something rendering it, no
prop without a caller passing it. If the library is missing something, raise it before building it.

## PR checklist

- [ ] Folder is `ComponentName/` with `.tsx`, `.gallery.tsx`, `index.ts`
- [ ] Props typed with a type or interface; unions for `variant` and `state`
- [ ] No fetch, navigation, store, adapter or access logic
- [ ] Callbacks are `on<Event>`
- [ ] No raw hexes or bare numbers; tokens from `theme/tokens.ts`
- [ ] Loading, empty, error and offline handled, or documented as excluded
- [ ] Nothing duplicated into a screen folder
- [ ] Renders in the gallery with hardcoded props and no providers
- [ ] Gallery covers every variant × state, plus overflow and missing fields
- [ ] Every variant and prop has a real caller

If you wrote the component being extended, you are a required reviewer.

## Open questions

- Accessibility baseline: required `accessibilityRole` / `accessibilityLabel`, minimum touch target.
- What gets a test, and whether a gallery entry substitutes for one.
- Dark mode. `tokens.ts` has no scheme dimension, so adding one later touches every component.
- Where `/gallery` mounts, and what keeps it out of a release build.
