// Owner: Reader (Ahana). Temp, and it goes with the file it tests.
//
// Only the two behaviours added for the accessibility work are covered here: the announce gates
// (which nothing else in the app can write, so without a control they are unreachable on a device)
// and the Flow/Spread rows going inert while the Reader is overriding `layout.flow` for a screen
// reader. The rest of this menu is exercised through ReaderScreen's own prefs-application tests.

import { render, screen, fireEvent, act } from '@testing-library/react-native';

import { prefsStore } from '@/features/personalization/prefsStore';
import { setOverrideDeclined } from '@/features/reader/a11yOverrideChoice';
import { useScreenReaderEnabled } from '@/features/reader/useScreenReaderEnabled';
import { DEFAULT_PREFS } from '@/shared/contracts';
import type { SharedPrefs } from '@/shared/contracts';

import { DevPreferencesMenu } from './DevPreferencesMenu';

jest.mock('@/features/personalization/prefsStore', () => ({
  prefsStore: {
    getPrefs: jest.fn(),
    savePrefs: jest.fn(() => Promise.resolve()),
    subscribe: jest.fn(() => () => undefined),
  },
}));

jest.mock('@/features/reader/useScreenReaderEnabled', () => ({
  useScreenReaderEnabled: jest.fn(() => false),
}));

function makePrefs(): SharedPrefs {
  return {
    ...structuredClone(DEFAULT_PREFS),
    id: 'prefs-1',
    userId: 'user-1',
    updatedAt: 0,
    isDeleted: false,
    synced: false,
  };
}

beforeEach(() => {
  jest.mocked(prefsStore.getPrefs).mockResolvedValue(makePrefs());
  jest.mocked(useScreenReaderEnabled).mockReturnValue(false);
  jest.mocked(prefsStore.savePrefs).mockClear();
  setOverrideDeclined(false);
});

async function openMenu(): Promise<void> {
  await render(<DevPreferencesMenu format="EPUB" />);
  await act(async () => {
    await Promise.resolve();
  });
  await fireEvent.press(screen.getByLabelText('Open preferences menu'));
}

describe('the announcement gates', () => {
  it('shows both, on by default', async () => {
    // Both are among the four DEFAULT_ACCESSIBILITY_PREFS entries that are not "off" — which is why
    // these are plain flips rather than this file's usual revert-to-default toggles.
    await openMenu();

    expect(screen.getByLabelText('Pages announcements: On')).toBeTruthy();
    expect(screen.getByLabelText('Chapters announcements: On')).toBeTruthy();
  });

  it('turns page announcements off without touching chapters', async () => {
    // Separate preferences on purpose: a page turn announces constantly, a chapter change a handful
    // of times a book. Silencing one must not silence the other.
    await openMenu();

    await fireEvent.press(screen.getByLabelText('Pages announcements: On'));

    expect(prefsStore.savePrefs).toHaveBeenCalledWith({
      accessibility: expect.objectContaining({
        announce: { pageChanges: false, chapterChanges: true },
      }),
    });
  });

  it('turns chapter announcements off without touching pages', async () => {
    await openMenu();

    await fireEvent.press(screen.getByLabelText('Chapters announcements: On'));

    expect(prefsStore.savePrefs).toHaveBeenCalledWith({
      accessibility: expect.objectContaining({
        announce: { pageChanges: true, chapterChanges: false },
      }),
    });
  });
});

describe('the Layout rows while a screen reader is running', () => {
  it('leaves them alone when nothing is overridden', async () => {
    await openMenu();

    expect(screen.queryByTestId('prefs-flow-override-note')).toBeNull();
    expect(screen.getByLabelText('Flow: Paginated, selected').props.accessibilityState).toMatchObject(
      { disabled: false },
    );
  });

  it('disables them and says why once the Reader takes over flow', async () => {
    // A control with nothing to control is worse than no control — this file already applies that
    // to Zoom on EPUB. Disabled rather than hidden, because unlike Zoom this is reversible and the
    // user has to be able to find out why their toggle stopped responding.
    jest.mocked(useScreenReaderEnabled).mockReturnValue(true);
    await openMenu();

    expect(screen.getByTestId('prefs-flow-override-note')).toBeTruthy();
    expect(
      screen.getByLabelText('Flow: Paginated, selected').props.accessibilityState,
    ).toMatchObject({ disabled: true });
    expect(screen.getByLabelText('Spread: Single, selected').props.accessibilityState).toMatchObject(
      { disabled: true },
    );
  });

  it('re-enables them once the user chooses to keep pages', async () => {
    // The reader's alert and this menu have to agree; they are not parent and child, which is why
    // the choice lives in a module. See a11yOverrideChoice.ts.
    jest.mocked(useScreenReaderEnabled).mockReturnValue(true);
    await openMenu();

    await act(async () => {
      setOverrideDeclined(true);
    });

    expect(screen.queryByTestId('prefs-flow-override-note')).toBeNull();
    expect(
      screen.getByLabelText('Flow: Paginated, selected').props.accessibilityState,
    ).toMatchObject({ disabled: false });
  });

  it('does not disable them for a reader who already chose scrolled flow', async () => {
    // Nothing was overridden, so nothing is taken over.
    const scrolled = makePrefs();
    scrolled.layout = { flow: 'scrolled-doc', spread: 'single' };
    jest.mocked(prefsStore.getPrefs).mockResolvedValue(scrolled);
    jest.mocked(useScreenReaderEnabled).mockReturnValue(true);

    await openMenu();

    expect(screen.queryByTestId('prefs-flow-override-note')).toBeNull();
  });
});
