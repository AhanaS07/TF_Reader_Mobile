// src/components/ErrorState/ErrorState.test.tsx
// ErrorState renders copy the caller has already resolved, plus at most one
// action. Which action appears is the whole behaviour: retrying a 404 or an
// expired entitlement cannot succeed, so only `network` and `not_ready` offer it.
//
// `message` is a STRING, never an Error. Design Spec §4.2 forbids exposing stack
// traces, and taking a string makes leaking one structurally impossible rather
// than merely discouraged — the type test below is the guard.
//
// Copy is keyed on `code` upstream: the code-to-copy map is owned by Akriti and
// lives beside the resolver, so this component receives the result. The messages
// used below are therefore fixtures, not component copy.
//
// `await render(...)` is required — see the note in ContentCard.test.tsx.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ErrorState } from '@components/ErrorState';

describe('ErrorState message', () => {
  it('renders the message it is given, verbatim', async () => {
    await render(<ErrorState variant="network" message="You appear to be offline." />);

    expect(screen.getByText('You appear to be offline.')).toBeTruthy();
  });

  it('renders the message for every variant', async () => {
    const { rerender } = await render(<ErrorState variant="network" message="one" />);
    expect(screen.getByText('one')).toBeTruthy();

    await rerender(<ErrorState variant="not_found" message="two" />);
    expect(screen.getByText('two')).toBeTruthy();

    await rerender(<ErrorState variant="access_restricted" message="three" />);
    expect(screen.getByText('three')).toBeTruthy();

    await rerender(<ErrorState variant="not_ready" message="four" />);
    expect(screen.getByText('four')).toBeTruthy();
  });

  // The component must not decorate, prefix or derive copy — the resolver already
  // mapped `code` to this string.
  it('adds nothing around the message', async () => {
    await render(
      <ErrorState variant="access_restricted" message="Your library's subscription has expired." />,
    );

    expect(screen.getByText("Your library's subscription has expired.")).toBeTruthy();
  });

  // `code` travels with the failure but does not change what is drawn, because
  // the copy arrived already resolved.
  it('accepts a code without altering the rendered message', async () => {
    await render(
      <ErrorState
        variant="access_restricted"
        message="Your library does not hold this title."
        code="NO_ENTITLEMENT"
      />,
    );

    expect(screen.getByText('Your library does not hold this title.')).toBeTruthy();
  });
});

describe('ErrorState network', () => {
  it('offers Retry', async () => {
    await render(<ErrorState variant="network" message="Offline." onRetry={() => {}} />);

    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('reports the press through onRetry', async () => {
    const onRetry = jest.fn();
    await render(<ErrorState variant="network" message="Offline." onRetry={onRetry} />);

    fireEvent.press(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no Learn more', async () => {
    await render(<ErrorState variant="network" message="Offline." onLearnMore={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Learn more' })).toBeNull();
  });

  it('does not crash when pressed without a handler', async () => {
    await render(<ErrorState variant="network" message="Offline." />);

    fireEvent.press(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('Offline.')).toBeTruthy();
  });
});

describe('ErrorState not_ready', () => {
  // The one non-network variant where retrying is meaningful: the content is
  // still being ingested, so the same request can succeed later.
  it('offers Retry', async () => {
    await render(
      <ErrorState
        variant="not_ready"
        message="Still being prepared."
        code="CONTENT_NOT_READY"
        onRetry={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('reports the press through onRetry', async () => {
    const onRetry = jest.fn();
    await render(
      <ErrorState variant="not_ready" message="Still being prepared." onRetry={onRetry} />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorState access_restricted', () => {
  it('offers Learn more', async () => {
    await render(
      <ErrorState variant="access_restricted" message="Expired." onLearnMore={() => {}} />,
    );

    expect(screen.getByRole('button', { name: 'Learn more' })).toBeTruthy();
  });

  it('reports the press through onLearnMore', async () => {
    const onLearnMore = jest.fn();
    await render(
      <ErrorState variant="access_restricted" message="Expired." onLearnMore={onLearnMore} />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Learn more' }));

    expect(onLearnMore).toHaveBeenCalledTimes(1);
  });

  // Retrying an entitlement failure sends the same request to the same answer.
  it('offers no Retry even when a retry handler is passed', async () => {
    await render(
      <ErrorState
        variant="access_restricted"
        message="Expired."
        onRetry={() => {}}
        onLearnMore={() => {}}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('ErrorState not_found', () => {
  // wokay return the same 404 for unknown, archived and not-entitled so the
  // catalogue cannot be mapped by walking ids. No action can resolve it.
  it('offers no action at all', async () => {
    await render(<ErrorState variant="not_found" message="Not found." code="NOT_FOUND" />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers no Retry even when a retry handler is passed', async () => {
    await render(
      <ErrorState variant="not_found" message="Not found." onRetry={() => {}} />,
    );

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('ErrorState refuses an Error object', () => {
  // The guard is the type, checked by `npm run typecheck`: @ts-expect-error fails
  // the build if passing an Error ever becomes legal. That is what makes a leaked
  // stack trace structurally impossible rather than merely discouraged.
  it('does not type-check when handed an Error', () => {
    const rejected = (
      // @ts-expect-error message must be a string; an Error must never reach this prop.
      <ErrorState variant="network" message={new Error('boom at ErrorState.tsx:1')} />
    );

    expect(rejected).toBeTruthy();
  });

  // Even a message derived from a failure is just text — nothing reads .stack.
  it('renders a failure-derived string without exposing internals', async () => {
    await render(<ErrorState variant="network" message="We could not reach the catalogue." />);

    expect(screen.getByText('We could not reach the catalogue.')).toBeTruthy();
    expect(screen.queryByText(/\.tsx/)).toBeNull();
    expect(screen.queryByText(/ at /)).toBeNull();
  });
});
