// A labelled form input, with its own validation message and an optional reveal
// toggle for passwords.
//
// SearchInput cannot stand in for this. That is a raised search card (16px radius,
// elevation, no label); a form field is boxed, labelled, and has to show why it is
// invalid. Two different jobs, so two components rather than one with a mode flag.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { KeyboardTypeOptions, TextInputProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { color, radius, space, type } from '@theme/tokens';

// 48 clears the 44pt minimum touch target. Composed from the spacing scale so no
// bare number reaches the stylesheet.
const FIELD_HEIGHT = space.xl + space.md;
const ICON_SIZE = 22;

export interface TextFieldProps {
  /** Sits above the field, and is also the accessibility label. */
  label: string;
  /** Controlled — the screen owns the text, never this component. */
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /**
   * Validation message shown beneath the field. Its presence is what makes the
   * field read as invalid — there is no separate `invalid` boolean, because two
   * sources for one fact drift apart.
   */
  error?: string;
  /** Masks the text and adds the reveal toggle. */
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: TextInputProps['autoComplete'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  editable?: boolean;
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps['returnKeyType'];
  /** Prefixes this field's own testIDs, so a form with three fields can address each. */
  testID: string;
}

export default function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry = false,
  keyboardType,
  autoComplete,
  autoCapitalize = 'none',
  editable = true,
  onSubmitEditing,
  returnKeyType,
  testID,
}: TextFieldProps) {
  // Focus and reveal are presentation of an interaction, which is the one kind of
  // state a controlled input may hold.
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const invalid = error !== undefined;
  const masked = secureTextEntry && !revealed;

  function handleReveal() {
    setRevealed(!revealed);
  }

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>

      {/* `fieldInvalid` is last so a red border wins over a focused blue one — a
          field you are typing into is still the field that is wrong. */}
      <View
        testID={`${testID}-field`}
        style={[
          styles.field,
          focused && styles.fieldFocused,
          !editable && styles.fieldDisabled,
          invalid && styles.fieldInvalid,
        ]}
      >
        <TextInput
          testID={`${testID}-input`}
          style={styles.input}
          value={value}
          placeholder={placeholder}
          placeholderTextColor={color.textSecondary}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          secureTextEntry={masked}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          editable={editable}
          returnKeyType={returnKeyType}
          accessibilityLabel={label}
          // The message is the hint rather than part of the label, so a screen
          // reader announces the field's name first and the fault second.
          accessibilityHint={error}
          accessibilityState={{ disabled: !editable }}
        />

        {secureTextEntry && (
          <Pressable
            testID={`${testID}-reveal`}
            onPress={handleReveal}
            hitSlop={space.sm}
            style={styles.revealButton}
            accessibilityRole="button"
            accessibilityLabel={revealed ? `Hide ${label}` : `Show ${label}`}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={ICON_SIZE}
              color={color.textSecondary}
            />
          </Pressable>
        )}
      </View>

      {invalid && (
        <Text testID={`${testID}-error`} style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: space.xs,
  },
  label: {
    fontWeight: type.smallLabel.weight,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.textSecondary,
  },
  field: {
    height: FIELD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.white,
    borderWidth: 1,
    borderColor: color.border,
    // The 8 card step, not SearchInput's 16 — the tighter corner is what reads as
    // a form field rather than a search card.
    borderRadius: radius.card,
    paddingHorizontal: space.md,
  },
  fieldFocused: {
    borderColor: color.primary,
  },
  fieldInvalid: {
    borderColor: color.error,
  },
  fieldDisabled: {
    backgroundColor: color.border,
  },
  input: {
    flex: 1,
    fontWeight: type.body.weight,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
    // Android adds generous default vertical padding; zeroing it keeps the text
    // on the same baseline as the reveal icon beside it.
    paddingVertical: 0,
  },
  revealButton: {
    marginLeft: space.sm,
  },
  errorText: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.error,
  },
});
