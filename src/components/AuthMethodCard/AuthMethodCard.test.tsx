// src/components/AuthMethodCard/AuthMethodCard.test.tsx
//
// Covered behaviours:
//   1. Title and subtitle render; the subtitle is the accessibility hint.
//   2. Presses report out.
//   3. `disabled` refuses the press and is announced, but the card still renders —
//      shown, not hidden, so the reader learns the option exists.
//   4. The trailing chevron carries a derived testID the screens assert on.
import { fireEvent, render, screen } from '@testing-library/react-native';

import AuthMethodCard from './AuthMethodCard';

function makeProps(over: Partial<{ disabled: boolean; onPress: () => void }> = {}) {
  return {
    testID: 'method-institution',
    icon: 'business-outline' as const,
    title: 'Through my institution',
    subtitle: 'Sign in via SAML/SSO',
    onPress: jest.fn(),
    ...over,
  };
}

describe('AuthMethodCard', () => {
  it('renders the title and subtitle', async () => {
    await render(<AuthMethodCard {...makeProps()} />);

    expect(screen.getByText('Through my institution')).toBeTruthy();
    expect(screen.getByText('Sign in via SAML/SSO')).toBeTruthy();
  });

  it('names itself by its title and hints with its subtitle', async () => {
    await render(<AuthMethodCard {...makeProps()} />);

    const card = screen.getByLabelText('Through my institution');
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityHint).toBe('Sign in via SAML/SSO');
  });

  it('reports a press', async () => {
    const onPress = jest.fn();
    await render(<AuthMethodCard {...makeProps({ onPress })} />);

    await fireEvent.press(screen.getByTestId('method-institution'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('still renders when disabled — shown, not hidden', async () => {
    await render(<AuthMethodCard {...makeProps({ disabled: true })} />);

    expect(screen.getByText('Through my institution')).toBeTruthy();
  });

  it('refuses a press when disabled and says so', async () => {
    const onPress = jest.fn();
    await render(<AuthMethodCard {...makeProps({ disabled: true, onPress })} />);

    await fireEvent.press(screen.getByTestId('method-institution'));

    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Through my institution').props.accessibilityState).toMatchObject(
      { disabled: true },
    );
  });

  it('derives the chevron testID from its own, so screens can assert on it', async () => {
    await render(<AuthMethodCard {...makeProps()} />);

    expect(screen.getByTestId('method-institution-chevron')).toBeTruthy();
  });
});
