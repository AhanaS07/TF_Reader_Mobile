// The three states adjacent, so "visibly different" can be checked by eye rather
// than argued about. Plus one bar per row of the access table. CONVENTIONS §9.
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ActionId } from '@model/types';
import { color, space, type } from '@theme/tokens';

import ActionBar from './ActionBar';

// Every row of index.html's access table, written out by hand. Nothing here
// derives a tier — the point of the component is that it cannot. This is the
// screen's job, and in Week 2 it becomes resolveAccess's.
const RESOLVES: { caption: string; actions: ActionId[]; done?: ActionId }[] = [
  { caption: 'Open Access — no licence, no check, ever', actions: ['read', 'download'] },
  { caption: 'Subscription — same pair, licence work hidden behind the tap', actions: ['read', 'download'] },
  { caption: 'Elite 1 of 3 — no licence held, so the queue is the only way in', actions: ['addToQueue'] },
  {
    caption: 'Elite 2 of 3 — queued and waiting; the same button, spent',
    actions: ['addToQueue'],
    done: 'addToQueue',
  },
  {
    caption: 'Elite 3 of 3 — licence held. Read and revoke, and NO Download at any point',
    actions: ['read', 'revokeLicence'],
  },
  { caption: 'Signed out on a licensed tier', actions: ['signIn'] },
  { caption: 'B2C — subscribe, then read + download inside the licence', actions: ['subscribe'] },
];

export default function ActionBarGallery() {
  const [log, setLog] = useState<string>('nothing yet');
  // A fake trigger for the in-flight state, so the spinner can be seen without a
  // server. Same idea as the fake queue trigger index.html asks for.
  const [pending, setPending] = useState<ActionId | undefined>(undefined);

  const press = (action: ActionId) => {
    setLog(action);
    setPending(action);
  };

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>ActionBar</Text>
      <Text style={styles.readout}>
        Last pressed: {log}
        {pending !== undefined && ' — tap a bar below to clear'}
      </Text>

      <Text style={styles.caption}>
        The three states, adjacent. They must not be mistakable for one another.
      </Text>

      <View style={styles.group}>
        <Text style={styles.label}>1 · loading — we asked and have not heard back</Text>
        <ActionBar actions={['read', 'download']} state="loading" onAction={press} />
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>
          2 · error — we asked and never got an answer. A retry, and nothing else. `actions`
          contains download here and it must NOT appear.
        </Text>
        <ActionBar
          actions={['read', 'download']}
          state="error"
          onAction={press}
          onRetry={() => {
            setLog('retry');
            setPending(undefined);
          }}
        />
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>
          3 · resolved to nothing — an answer arrived and it was &quot;nothing&quot;. Renders null,
          so the dashed box below should be empty.
        </Text>
        <View style={styles.emptyProof}>
          <ActionBar actions={[]} onAction={press} />
        </View>
      </View>

      <Text style={styles.caption}>Every row of the access table, resolved by hand</Text>

      {RESOLVES.map(({ caption, actions, done }) => (
        <View key={caption} style={styles.group}>
          <Text style={styles.label}>{caption}</Text>
          <ActionBar
            actions={actions}
            done={done}
            pending={pending !== undefined && actions.includes(pending) ? pending : undefined}
            onAction={press}
          />
        </View>
      ))}

      <View style={styles.group}>
        <Text style={styles.label}>
          Awkward case — three actions at once, so the quiet one drops to its own line
        </Text>
        <ActionBar actions={['read', 'download', 'revokeLicence']} onAction={press} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: space.md, gap: space.lg, paddingBottom: space.xl },
  heading: {
    fontWeight: type.sectionHeader.weight,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
  },
  readout: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.primary,
  },
  group: { gap: space.xs },
  caption: {
    fontWeight: type.sectionHeader.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textPrimary,
  },
  label: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
  // A dashed outline around the empty case. Without it the reviewer cannot tell
  // "renders nothing" from "the gallery forgot to render it".
  emptyProof: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    minHeight: space.xl,
  },
});
