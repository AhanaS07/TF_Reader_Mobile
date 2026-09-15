// src/components/TextField/TextField.test.tsx
//
// Covered behaviours:
//   1. Label renders, and is the field's accessibility label.
//   2. Controlled: value is displayed, keystrokes report out via onChangeText.
//   3. `error` renders the message, and rides along as the accessibility hint.
//   4. `secureTextEntry` masks the input and the reveal toggle unmasks it.
//   5. No reveal control at all on a plain field.
//   6. `editable={false}` blocks typing.
import { fireEvent, render, screen } from '@testing-library/react-native';

import TextField from './TextField';

describe('TextField', () => {
  it('renders the label and uses it as the accessibility label', async () => {
    await render(
      <TextField testID="email" label="Email" value="" onChangeText={jest.fn()} />,
    );

    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('displays the value it is given', async () => {
    await render(
      <TextField testID="email" label="Email" value="reader@tf.com" onChangeText={jest.fn()} />,
    );

    expect(screen.getByTestId('email-input').props.value).toBe('reader@tf.com');
  });

  it('reports keystrokes out rather than holding the text itself', async () => {
    const onChangeText = jest.fn();
    await render(
      <TextField testID="email" label="Email" value="" onChangeText={onChangeText} />,
    );

    await fireEvent.changeText(screen.getByTestId('email-input'), 'a@b.com');

    expect(onChangeText).toHaveBeenCalledWith('a@b.com');
  });

  it('renders no error message when the field is valid', async () => {
    await render(
      <TextField testID="email" label="Email" value="" onChangeText={jest.fn()} />,
    );

    expect(screen.queryByTestId('email-error')).toBeNull();
  });

  it('renders the error message and attaches it as the accessibility hint', async () => {
    await render(
      <TextField
        testID="email"
        label="Email"
        value="nope"
        onChangeText={jest.fn()}
        error="Enter a valid email address."
      />,
    );

    expect(screen.getByTestId('email-error')).toBeTruthy();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    // The message is the hint, not part of the label, so a screen reader
    // announces the field's name first and the fault second.
    expect(screen.getByLabelText('Email').props.accessibilityHint).toBe(
      'Enter a valid email address.',
    );
  });

  it('masks a secure field and unmasks it when the reveal is pressed', async () => {
    await render(
      <TextField
        testID="password"
        label="Password"
        value="hunter2"
        onChangeText={jest.fn()}
        secureTextEntry
      />,
    );

    expect(screen.getByTestId('password-input').props.secureTextEntry).toBe(true);

    await fireEvent.press(screen.getByTestId('password-reveal'));

    expect(screen.getByTestId('password-input').props.secureTextEntry).toBe(false);
  });

  it('labels the reveal control for what it will do next', async () => {
    await render(
      <TextField
        testID="password"
        label="Password"
        value="hunter2"
        onChangeText={jest.fn()}
        secureTextEntry
      />,
    );

    expect(screen.getByLabelText('Show Password')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('password-reveal'));

    expect(screen.getByLabelText('Hide Password')).toBeTruthy();
  });

  // Focus is the one piece of state a controlled input may hold, and it is what
  // turns the border blue. Asserted through the field wrapper's style, because
  // the colour is the only thing focus changes.
  it('takes the focused border on focus and drops it on blur', async () => {
    await render(
      <TextField testID="email" label="Email" value="" onChangeText={jest.fn()} />,
    );
    const input = screen.getByTestId('email-input');

    await fireEvent(input, 'focus');
    const focused = screen.getByTestId('email-field').props.style;

    await fireEvent(input, 'blur');
    const blurred = screen.getByTestId('email-field').props.style;

    expect(focused).not.toEqual(blurred);
  });

  // An invalid field you are typing into is still an invalid field, so the red
  // border has to survive focus rather than being replaced by the blue one.
  it('keeps the invalid border while focused', async () => {
    await render(
      <TextField
        testID="email"
        label="Email"
        value="nope"
        onChangeText={jest.fn()}
        error="Enter a valid email address."
      />,
    );
    const invalidBlurred = screen.getByTestId('email-field').props.style;

    await fireEvent(screen.getByTestId('email-input'), 'focus');

    const invalidFocused = screen.getByTestId('email-field').props.style;
    // The invalid style is applied last in the array, so it wins either way.
    expect(invalidFocused[invalidFocused.length - 1]).toEqual(
      invalidBlurred[invalidBlurred.length - 1],
    );
  });

  it('offers no reveal control on a plain field', async () => {
    await render(
      <TextField testID="email" label="Email" value="" onChangeText={jest.fn()} />,
    );

    expect(screen.queryByTestId('email-reveal')).toBeNull();
  });

  it('is not editable while the form is submitting', async () => {
    await render(
      <TextField
        testID="email"
        label="Email"
        value=""
        onChangeText={jest.fn()}
        editable={false}
      />,
    );

    expect(screen.getByTestId('email-input').props.editable).toBe(false);
    expect(screen.getByLabelText('Email').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});
