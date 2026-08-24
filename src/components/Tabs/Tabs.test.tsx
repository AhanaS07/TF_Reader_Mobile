// src/components/Tabs/Tabs.test.tsx
// Tabs appears on screen 01 (feed tabs), 04 (detail sections) and 09 (search
// scope). The tab sets used below are the real ones: the home-catalogue
// fixture's three navigation rows (eBooks / Audiobooks / Open access) and a
// two-tab set, because the component must render whatever array it is handed.
//
// THE TESTS NAME NO TAB IN AN ASSERTION ABOUT BEHAVIOUR. Foundation Spec §6.4
// component 5: tabs are "data, not code", and since 16 Aug 2026 that is settled
// rather than provisional — an administrator names the shelves per institution
// (AGENTS.md L-5). Every behavioural test below drives off the array's length or
// index, never off a hardcoded label, because a test that knew 'eBooks' was tab
// zero would only hold for one customer.
//
// The two behaviours worth protecting hardest: the component must hold NO
// internal selection state (§6.4 — "onChange must be the only way the active tab
// changes, so the consumer can swap cursors cleanly"), and re-pressing the
// active tab must not fire, or a consumer holding a per-tab pagination cursor
// would reset it on every stray tap.
//
// `await render(...)` is required — see the note in ContentCard.test.tsx.
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Tabs } from '@components/Tabs';
import { color } from '@theme/tokens';

// The fixture's navigation rows, as a tab set.
const THREE_TABS = [
  { id: 'ebooks', label: 'eBooks' },
  { id: 'audiobooks', label: 'Audiobooks' },
  { id: 'open-access', label: 'Open access' },
];

// Screen 04's detail sections — a different length, to prove nothing assumes three.
const TWO_TABS = [
  { id: 'description', label: 'Description' },
  { id: 'details', label: 'Details' },
];

function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

describe('Tabs content', () => {
  it('renders a tab for every entry it is handed', async () => {
    await render(<Tabs tabs={THREE_TABS} activeId="ebooks" onChange={() => {}} />);

    THREE_TABS.forEach((tab) => {
      expect(screen.getByText(tab.label)).toBeTruthy();
    });
  });

  it('renders a different-length tab set just as readily', async () => {
    await render(<Tabs tabs={TWO_TABS} activeId="details" onChange={() => {}} />);

    expect(screen.getAllByTestId(/^tabs-tab-/)).toHaveLength(TWO_TABS.length);
  });

  it('keys each tab by its id, not its position', async () => {
    await render(<Tabs tabs={THREE_TABS} activeId="ebooks" onChange={() => {}} />);

    THREE_TABS.forEach((tab) => {
      expect(screen.getByTestId(`tabs-tab-${tab.id}`)).toBeTruthy();
    });
  });

  it('renders nothing at all when handed an empty tab set', async () => {
    await render(<Tabs tabs={[]} activeId="" onChange={() => {}} />);

    // An empty tab bar is a stripe of dead chrome; absence is honest.
    expect(screen.queryByTestId('tabs')).toBeNull();
  });
});

describe('Tabs selection', () => {
  it('reports the pressed tab id to the caller', async () => {
    const onChange = jest.fn();
    await render(<Tabs tabs={THREE_TABS} activeId={THREE_TABS[0].id} onChange={onChange} />);

    fireEvent.press(screen.getByTestId(`tabs-tab-${THREE_TABS[1].id}`));

    expect(onChange).toHaveBeenCalledWith(THREE_TABS[1].id);
  });

  it('does not fire when the active tab is pressed again', async () => {
    const onChange = jest.fn();
    await render(<Tabs tabs={THREE_TABS} activeId={THREE_TABS[0].id} onChange={onChange} />);

    fireEvent.press(screen.getByTestId(`tabs-tab-${THREE_TABS[0].id}`));

    // A consumer holds a pagination cursor per tab (§6.4, A0); re-firing here
    // would reset it on a stray tap.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('holds no selection state of its own', async () => {
    await render(<Tabs tabs={THREE_TABS} activeId={THREE_TABS[0].id} onChange={() => {}} />);

    fireEvent.press(screen.getByTestId(`tabs-tab-${THREE_TABS[1].id}`));

    // activeId did not change, so neither may the highlight — onChange is the
    // only route to a new active tab.
    expect(
      screen.getByTestId(`tabs-tab-${THREE_TABS[0].id}`).props.accessibilityState.selected,
    ).toBe(true);
    expect(
      screen.getByTestId(`tabs-tab-${THREE_TABS[1].id}`).props.accessibilityState.selected,
    ).toBe(false);
  });

  it('selects nothing when activeId matches no tab', async () => {
    await render(<Tabs tabs={THREE_TABS} activeId="not-a-tab" onChange={() => {}} />);

    // Defensive: a stale cursor must not crash the bar or highlight tab zero.
    THREE_TABS.forEach((tab) => {
      expect(screen.getByTestId(`tabs-tab-${tab.id}`).props.accessibilityState.selected).toBe(
        false,
      );
    });
  });
});

describe('Tabs accessibility', () => {
  it('announces each tab as a tab', async () => {
    await render(<Tabs tabs={THREE_TABS} activeId={THREE_TABS[0].id} onChange={() => {}} />);

    expect(screen.getByTestId(`tabs-tab-${THREE_TABS[0].id}`).props.accessibilityRole).toBe('tab');
  });

  it('announces the group as a tab list', async () => {
    await render(<Tabs tabs={THREE_TABS} activeId={THREE_TABS[0].id} onChange={() => {}} />);

    expect(screen.getByTestId('tabs').props.accessibilityRole).toBe('tablist');
  });

  it('announces which tab is active', async () => {
    await render(<Tabs tabs={THREE_TABS} activeId={THREE_TABS[2].id} onChange={() => {}} />);

    expect(
      screen.getByTestId(`tabs-tab-${THREE_TABS[2].id}`).props.accessibilityState.selected,
    ).toBe(true);
  });
});

describe('Tabs variants', () => {
  it('underlines the active tab in the underline variant', async () => {
    await render(
      <Tabs
        tabs={THREE_TABS}
        activeId={THREE_TABS[1].id}
        variant="underline"
        onChange={() => {}}
      />,
    );

    expect(screen.getByTestId(`tabs-underline-${THREE_TABS[1].id}`)).toBeTruthy();
  });

  it('underlines only the active tab', async () => {
    await render(
      <Tabs
        tabs={THREE_TABS}
        activeId={THREE_TABS[1].id}
        variant="underline"
        onChange={() => {}}
      />,
    );

    expect(screen.getAllByTestId(/^tabs-underline-/)).toHaveLength(1);
  });

  it('draws no underline in the segmented variant', async () => {
    await render(
      <Tabs
        tabs={THREE_TABS}
        activeId={THREE_TABS[1].id}
        variant="segmented"
        onChange={() => {}}
      />,
    );

    expect(screen.queryAllByTestId(/^tabs-underline-/)).toHaveLength(0);
  });

  it('fills the active segment in the segmented variant', async () => {
    await render(
      <Tabs
        tabs={THREE_TABS}
        activeId={THREE_TABS[1].id}
        variant="segmented"
        onChange={() => {}}
      />,
    );

    expect(styleOf(`tabs-tab-${THREE_TABS[1].id}`).backgroundColor).toBe(color.primary);
  });

  it('leaves inactive segments unfilled', async () => {
    await render(
      <Tabs
        tabs={THREE_TABS}
        activeId={THREE_TABS[1].id}
        variant="segmented"
        onChange={() => {}}
      />,
    );

    expect(styleOf(`tabs-tab-${THREE_TABS[0].id}`).backgroundColor).not.toBe(color.primary);
  });

  it('defaults to segmented when no variant is given', async () => {
    await render(<Tabs tabs={THREE_TABS} activeId={THREE_TABS[1].id} onChange={() => {}} />);

    expect(styleOf(`tabs-tab-${THREE_TABS[1].id}`).backgroundColor).toBe(color.primary);
  });
});

describe('Tabs tokens', () => {
  it('tints the active label with the brand colour in the underline variant', async () => {
    await render(
      <Tabs
        tabs={THREE_TABS}
        activeId={THREE_TABS[0].id}
        variant="underline"
        onChange={() => {}}
      />,
    );

    expect(styleOf(`tabs-label-${THREE_TABS[0].id}`).color).toBe(color.primary);
  });

  it('greys inactive labels', async () => {
    await render(
      <Tabs
        tabs={THREE_TABS}
        activeId={THREE_TABS[0].id}
        variant="underline"
        onChange={() => {}}
      />,
    );

    expect(styleOf(`tabs-label-${THREE_TABS[1].id}`).color).toBe(color.textSecondary);
  });

  it('flips the active label clear of the teal fill in the segmented variant', async () => {
    await render(
      <Tabs
        tabs={THREE_TABS}
        activeId={THREE_TABS[0].id}
        variant="segmented"
        onChange={() => {}}
      />,
    );

    // Teal-on-teal would be unreadable.
    expect(styleOf(`tabs-label-${THREE_TABS[0].id}`).color).toBe(color.white);
  });
});
