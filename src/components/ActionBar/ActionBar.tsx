// src/components/ActionBar/ActionBar.tsx
// The strip that holds a publication's action buttons — the bar across the
// bottom of screens 04 and 05.
//
// IT IS HANDED A LIST AND LAYS IT OUT. It does not know which tier produced the
// list, whether the reader is signed in, or whether a licence exists. Hand it
// ['read', 'download'] and it draws two buttons; hand it ['grantAccess'] and it
// draws one; hand it [] and it draws nothing (CONVENTIONS §3).
//
// WHY THIS IS A COMPONENT AND NOT A <View style={{flexDirection:'row'}}>:
// somebody has to answer "what does this strip look like before we know the
// answer, and what does it look like when we never got one". A single button
// cannot answer that — it does not know it has siblings, and it does not know
// whether the request that would have created it came back. index.html §Access:
// the three states are distinct and MUST look distinct on screen.
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, actionEmphasis } from '@components/ActionButton';
import type { ActionId } from '@model/types';
import { color, radius, space, type } from '@theme/tokens';

// CONVENTIONS §4's lifecycle vocabulary. There is deliberately no 'empty':
// resolving to no actions is not a lifecycle state, it is a legitimate answer,
// so it is `state='idle'` with `actions: []` — see the render below.
export type ActionBarState = 'idle' | 'loading' | 'error';

export interface ActionBarProps {
  /**
   * The resolved actions, in the order they should appear. `[]` is legal and
   * meaningful: it is "this reader can do nothing with this title", which is a
   * real answer and not a failure.
   */
  actions: ActionId[];
  state?: ActionBarState;
  /** The one action currently waiting on flambeau. Only one tap can be in flight. */
  pending?: ActionId;
  /**
   * The one action already spent: rendered inert so it cannot fire twice. Since
   * 16 Aug no action carries a spent LABEL, so this changes behaviour and not
   * wording — its live use is an accepted offer, which must not be accepted again
   * while the borrow is in flight.
   */
  done?: ActionId;
  onAction: (action: ActionId) => void;
  /** Required in practice at state='error'; the retry is the only thing offered there. */
  onRetry?: () => void;
}

// What the skeleton stands in for. Two buttons is the common resolve
// (read + download on Open Access and Subscription), so the bar reserves close
// to its real height and the page does not jump when the answer lands. The
// values are invisible — a skeleton renders no label — but ActionButton needs a
// valid action, so these are placeholders rather than a claim about the item.
const SKELETON_SLOTS: ActionId[] = ['read', 'download'];

export default function ActionBar({
  actions,
  state = 'idle',
  pending,
  done,
  onAction,
  onRetry,
}: ActionBarProps) {
  // ── 1 of 3: we asked and have not heard back ───────────────────────────────
  if (state === 'loading') {
    return (
      <View testID="action-bar-loading" style={styles.bar}>
        <View style={styles.row}>
          {SKELETON_SLOTS.map((slot) => (
            <View key={slot} style={styles.slot}>
              <ActionButton action={slot} state="skeleton" />
            </View>
          ))}
        </View>
      </View>
    );
  }

  // ── 2 of 3: we asked and never got an answer ───────────────────────────────
  //
  // `actions` IS IGNORED HERE, DELIBERATELY. A failed resolve means we do not
  // know what this reader may do, so we offer nothing but another attempt.
  // index.html §Access: "Guessing towards the more generous button hands an
  // unentitled reader a file." If the caller supplied the buttons for this
  // state, a caller could pass ['download'] and that rule would break silently
  // in one screen — so the component refuses rather than trusting.
  //
  // This is not access logic (CONVENTIONS §3): nothing is computed from a user,
  // a tier or a date. It is one fixed fallback, and it is fixed precisely so it
  // cannot be got wrong.
  //
  // Not ErrorState: that is a full-screen centred block with `padding: space.xl`,
  // and this has to stay bar-height at the bottom of a scrolling detail screen.
  // The retry is styled to match ErrorState's so the two read as siblings.
  if (state === 'error') {
    return (
      <View testID="action-bar-error" style={styles.bar}>
        <View style={styles.errorRow}>
          <Text style={styles.errorMessage}>Couldn&apos;t load your options.</Text>
          <Pressable
            testID="action-bar-retry"
            onPress={onRetry}
            style={styles.retry}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── 3 of 3: we asked, we got an answer, and the answer is nothing ──────────
  //
  // Nothing at all. Not a message, not an error, and NOT an upsell —
  // index.html §Access: "Do not invent a 'request access' affordance for it;
  // there is no endpoint behind one." Rendering null rather than an empty View
  // so the bar contributes no height and no gap to the screen's layout.
  if (actions.length === 0) return null;

  // A `quiet` action drops to its own line beneath the row. "Revoke licence"
  // beside Read and Download would cram three labels into one row on a phone,
  // and it is the one action that should not compete for the tap anyway.
  // The weight comes from ActionButton via `actionEmphasis`, so this file never
  // names an action.
  const inRow = actions.filter((a) => actionEmphasis(a) !== 'quiet');
  const beneath = actions.filter((a) => actionEmphasis(a) === 'quiet');

  const stateFor = (action: ActionId) =>
    action === pending ? 'loading' : action === done ? 'done' : 'idle';

  return (
    <View testID="action-bar" style={styles.bar}>
      {inRow.length > 0 && (
        <View style={styles.row}>
          {inRow.map((action) => (
            // Each slot is flex:1, so two actions split the width evenly and a
            // single one fills it. The slot is a plain View, whose default
            // `alignItems: 'stretch'` is what makes the button and its skeleton
            // fill identically.
            <View key={action} style={styles.slot}>
              <ActionButton
                action={action}
                state={stateFor(action)}
                onPress={() => onAction(action)}
              />
            </View>
          ))}
        </View>
      )}

      {beneath.map((action) => (
        <ActionButton
          key={action}
          action={action}
          state={stateFor(action)}
          onPress={() => onAction(action)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // The bar pads itself and sets no outer margin, width or position — the screen
  // that places it owns that (CONVENTIONS §8).
  bar: {
    gap: space.sm,
    padding: space.md,
    backgroundColor: color.white,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  row: {
    flexDirection: 'row',
    gap: space.sm,
  },
  slot: {
    flex: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  errorMessage: {
    // Shrinks so a long message wraps instead of pushing Retry off the bar.
    flex: 1,
    fontWeight: type.body.weight,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
  },
  // Matches ErrorState's own retry, so a reader meets the same affordance twice.
  retry: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.primary,
  },
  retryLabel: {
    fontWeight: type.button.weight,
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
});
