// src/components/QueueNotification/QueueNotification.test.tsx
// The banner's job is small and easy to break quietly: show which title is being
// offered, report which button was pressed, and refuse a second press while the
// first is in flight. Answering one offer twice is the failure worth guarding.
//
// Labels are written out rather than imported from ActionButton, so a wrong label
// fails here instead of agreeing with itself — same approach as
// ActionButton.test.tsx.
//
// `await render(...)` is required — RTL 14's render is async. See the note in
// ContentCard.test.tsx.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { QueueNotification } from '@components/QueueNotification';

const ACCEPT = 'Accept';
const REJECT = 'Reject';

// ActionButton's own testIDs. Presses go to the Pressable itself rather than to
// the label inside it — same as ActionButton.test.tsx.
const ACCEPT_BUTTON = 'action-button-acceptOffer';
const REJECT_BUTTON = 'action-button-rejectOffer';

describe('QueueNotification content', () => {
  it('renders the title of the book being offered', async () => {
    await render(
      <QueueNotification title="Ethnographies of Waiting" onAccept={() => {}} onReject={() => {}} />,
    );

    expect(screen.getByText('Ethnographies of Waiting')).toBeTruthy();
  });

  it('renders both buttons', async () => {
    await render(
      <QueueNotification title="Rights for Robots" onAccept={() => {}} onReject={() => {}} />,
    );

    expect(screen.getByText(ACCEPT)).toBeTruthy();
    expect(screen.getByText(REJECT)).toBeTruthy();
  });

  it('renders a long title without dropping the buttons', async () => {
    const long =
      'The Routledge Handbook of Southeast Asian and Caribbean Ethnographic Practice, Second Edition';
    await render(<QueueNotification title={long} onAccept={() => {}} onReject={() => {}} />);

    expect(screen.getByText(long)).toBeTruthy();
    expect(screen.getByText(ACCEPT)).toBeTruthy();
    expect(screen.getByText(REJECT)).toBeTruthy();
  });
});

describe('QueueNotification expiry', () => {
  it('renders the expiry when minutes are given', async () => {
    await render(
      <QueueNotification
        title="Rights for Robots"
        expiresInMinutes={12}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.getByText('Expires in 12 minutes')).toBeTruthy();
  });

  it('renders no expiry line when none is given', async () => {
    await render(
      <QueueNotification title="Rights for Robots" onAccept={() => {}} onReject={() => {}} />,
    );

    expect(screen.queryByText(/expires in/i)).toBeNull();
    expect(screen.queryByText(/expiring/i)).toBeNull();
  });

  it('says minute rather than minutes at one', async () => {
    await render(
      <QueueNotification
        title="Rights for Robots"
        expiresInMinutes={1}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.getByText('Expires in 1 minute')).toBeTruthy();
  });

  // Minutes are worked out by the caller, so by the time this renders the offer
  // may already be out of time. "Expires in 0 minutes" would read as a bug.
  it('says expiring now rather than zero minutes', async () => {
    await render(
      <QueueNotification
        title="Rights for Robots"
        expiresInMinutes={0}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.getByText('Expiring now')).toBeTruthy();
  });
});

describe('QueueNotification actions', () => {
  it('reports Accept through onAccept', async () => {
    const onAccept = jest.fn();
    await render(
      <QueueNotification title="Rights for Robots" onAccept={onAccept} onReject={() => {}} />,
    );

    fireEvent.press(screen.getByTestId(ACCEPT_BUTTON));

    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('reports Reject through onReject', async () => {
    const onReject = jest.fn();
    await render(
      <QueueNotification title="Rights for Robots" onAccept={() => {}} onReject={onReject} />,
    );

    fireEvent.press(screen.getByTestId(REJECT_BUTTON));

    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('keeps the two answers independent', async () => {
    const onAccept = jest.fn();
    const onReject = jest.fn();
    await render(
      <QueueNotification title="Rights for Robots" onAccept={onAccept} onReject={onReject} />,
    );

    fireEvent.press(screen.getByTestId(ACCEPT_BUTTON));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  // Stated directly rather than by pressing both buttons in one test: two presses
  // in a single test open overlapping act() scopes, which React reports as an
  // error and which breaks every render after it in the file. The two tests above
  // already prove each button fires when nothing is pending.
  it('is idle by default, so neither button is busy or disabled', async () => {
    await render(
      <QueueNotification title="Rights for Robots" onAccept={() => {}} onReject={() => {}} />,
    );

    const accept = screen.getByLabelText(ACCEPT).props.accessibilityState;
    const reject = screen.getByLabelText(REJECT).props.accessibilityState;

    expect(accept.busy).toBe(false);
    expect(accept.disabled).toBe(false);
    expect(reject.busy).toBe(false);
    expect(reject.disabled).toBe(false);
  });
});

// One offer, one answer. A second press landing on top of a call already in
// flight would answer the same offer twice — a borrow the reader did not ask for,
// or a place in the queue given away after it was taken.
describe('QueueNotification while a tap is in flight', () => {
  it('ignores a second Accept while Accept is pending', async () => {
    const onAccept = jest.fn();
    await render(
      <QueueNotification
        title="Rights for Robots"
        pending="accept"
        onAccept={onAccept}
        onReject={() => {}}
      />,
    );

    fireEvent.press(screen.getByTestId(ACCEPT_BUTTON));

    expect(onAccept).not.toHaveBeenCalled();
  });

  it('ignores Reject while Accept is pending', async () => {
    const onReject = jest.fn();
    await render(
      <QueueNotification
        title="Rights for Robots"
        pending="accept"
        onAccept={() => {}}
        onReject={onReject}
      />,
    );

    fireEvent.press(screen.getByTestId(REJECT_BUTTON));

    expect(onReject).not.toHaveBeenCalled();
  });

  it('ignores Accept while Reject is pending', async () => {
    const onAccept = jest.fn();
    await render(
      <QueueNotification
        title="Rights for Robots"
        pending="reject"
        onAccept={onAccept}
        onReject={() => {}}
      />,
    );

    fireEvent.press(screen.getByTestId(ACCEPT_BUTTON));

    expect(onAccept).not.toHaveBeenCalled();
  });

  it('shows the busy state on the button that was pressed, and only that one', async () => {
    await render(
      <QueueNotification
        title="Rights for Robots"
        pending="accept"
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    // ActionButton marks an in-flight button busy for screen readers; the other
    // is merely disabled.
    expect(screen.getByLabelText(ACCEPT).props.accessibilityState.busy).toBe(true);
    expect(screen.getByLabelText(REJECT).props.accessibilityState.busy).toBe(false);
    expect(screen.getByLabelText(REJECT).props.accessibilityState.disabled).toBe(true);
  });
});

describe('QueueNotification stays presentational', () => {
  // It is handed a title and a number. Nothing about holds, loans, licences or
  // queue positions reaches it, so none of it can leak onto a screen.
  it('renders no licence, hold or queue-position detail', async () => {
    await render(
      <QueueNotification
        title="Rights for Robots"
        expiresInMinutes={12}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.queryByText(/licence|license/i)).toBeNull();
    expect(screen.queryByText(/loan|hold/i)).toBeNull();
    expect(screen.queryByText(/queue|position/i)).toBeNull();
  });

  it('renders with no provider, store, navigator or network', async () => {
    await render(
      <QueueNotification title="Rights for Robots" onAccept={() => {}} onReject={() => {}} />,
    );

    expect(screen.getByText('Rights for Robots')).toBeTruthy();
  });
});
