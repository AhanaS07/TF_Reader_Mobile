// Owner: Reader (Ahana).
//
// >>> READ THIS BEFORE ADDING A CASE. <<< Only ONE of `focusOn`'s four paths can be exercised here,
// and it is not for want of trying. `findNodeHandle` cannot be intercepted from a consuming module
// under this preset: `jest.spyOn(ReactNative, 'findNodeHandle')` does not take effect (the real
// implementation still runs and rejects the stand-in node), `jest.mock('react-native', ...)` with a
// plain factory breaks jest-expo's own boot (its setup calls `Platform.select`), and
// `jest.requireActual('react-native')` pulls in native module registration that throws outside a
// real binary. All three were tried.
//
// So what is left is the path that returns BEFORE touching react-native at all — the empty ref —
// which happens to be the one that actually fires in practice, every time a ref points at an
// unmounted control.
//
// The other three (a resolved handle, a null handle, a throwing native call) are covered by the
// device pass in this feature's plan, not here. `ReaderScreen.test.tsx` mocks this module out
// entirely and asserts the DECISION — which control gets focus back and when — which is the part
// that has real logic in it.

import { AccessibilityInfo } from 'react-native';

import { focusOn } from './a11yFocus';

describe('focusOn', () => {
  it('does nothing when the ref is empty', () => {
    // The common case, not an edge case: a ref pointing at a conditionally-rendered control is null
    // whenever that control is unmounted, and callers fire this from a press handler that has no
    // way to know. Returning early here is what lets every call site stay a bare `focusOn(ref)`.
    const spy = jest
      .spyOn(AccessibilityInfo, 'setAccessibilityFocus')
      .mockImplementation(() => undefined);

    expect(() => focusOn({ current: null })).not.toThrow();
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});
