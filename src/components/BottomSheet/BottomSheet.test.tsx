import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import BottomSheet from './BottomSheet';

// BottomSheet wraps everything in a Modal. The Modal only mounts children once
// modalVisible becomes true, which happens inside a setTimeout(fn, 0) in
// slideIn() — required to satisfy the react-hooks/set-state-in-effect rule.
// Fake timers let us advance past that delay inside act() without the timer
// firing after Jest tears down the environment.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// Helper: render BottomSheet with visible=true and flush the slideIn timer.
async function renderOpen(dismissible = true) {
  const result = await render(
    <BottomSheet visible onDismiss={() => {}} dismissible={dismissible}>
      <Text>Sheet content</Text>
    </BottomSheet>,
  );
  await act(async () => { jest.runAllTimers(); });
  return result;
}

describe('BottomSheet visibility', () => {
  it('renders no content when visible is false', async () => {
    await render(
      <BottomSheet visible={false} onDismiss={() => {}}>
        <Text>Hidden content</Text>
      </BottomSheet>,
    );
    expect(screen.queryByText('Hidden content')).toBeNull();
  });

  it('renders children once the sheet has opened', async () => {
    const { getByText } = await renderOpen();
    expect(getByText('Sheet content')).toBeTruthy();
  });
});

// Walks the toJSON() tree looking for a node matching a predicate.
function findNode(node: ReturnType<typeof screen.toJSON>, pred: (n: { props: Record<string, unknown> }) => boolean): { props: Record<string, unknown> } | null {
  if (!node || Array.isArray(node)) return null;
  if (pred(node as { props: Record<string, unknown> })) return node as { props: Record<string, unknown> };
  for (const child of (node.children ?? [])) {
    const found = findNode(child as ReturnType<typeof screen.toJSON>, pred);
    if (found) return found;
  }
  return null;
}

describe('BottomSheet dismissible prop', () => {
  it('backdrop is accessible when dismissible is true', async () => {
    await renderOpen(true);
    const backdrop = findNode(screen.toJSON(), n => n.props.testID === 'bottom-sheet-backdrop');
    expect(backdrop?.props.accessible).toBe(true);
  });

  it('backdrop is not accessible when dismissible is false', async () => {
    await renderOpen(false);
    const backdrop = findNode(screen.toJSON(), n => n.props.testID === 'bottom-sheet-backdrop');
    expect(backdrop?.props.accessible).toBe(false);
  });
});
