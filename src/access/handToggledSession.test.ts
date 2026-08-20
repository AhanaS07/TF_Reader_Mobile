// A7 — the hand-toggled session is a stand-in for real sign-in, not a feature
// with its own rules, so this file tests exactly one thing: does an
// institution id produce a Session, and does null produce null.
import { resolveAccess } from '@access/resolveAccess';
import { handToggledSession } from '@access/handToggledSession';

const INSTITUTION_ID = 'inst_a21';

it('is null when no institution is selected — the signed-out state', () => {
  expect(handToggledSession(null)).toBeNull();
});

it('is a Session once an institution is selected — the signed-in state', () => {
  expect(handToggledSession(INSTITUTION_ID)).not.toBeNull();
});

// resolveAccess reads nothing off Session but its null-ness today (grep finds
// no other read anywhere in the app) — so the one behaviour that actually
// matters is that a licensed tier stops asking the reader to sign in once an
// institution is selected. This is the test that would have caught A7's core
// still being unbuilt: it exercises resolveAccess, not just this file's return
// type.
it('unlocks a licensed tier that would otherwise ask the reader to sign in', () => {
  const subscriptionItem = {
    id: 'item_1',
    acquisition: {
      actionId: 'acquire' as const,
      href: 'https://api.tf/api/v1/loans?itemId=item_1',
      licenceModel: 'SUBSCRIPTION' as const,
      encryption: null,
      hasSearchIndex: true,
      canPersist: true,
    },
  };

  const signedOut = resolveAccess({
    item: subscriptionItem,
    institutionId: null,
    session: handToggledSession(null),
  });
  const signedIn = resolveAccess({
    item: subscriptionItem,
    institutionId: INSTITUTION_ID,
    session: handToggledSession(INSTITUTION_ID),
  });

  expect(signedOut.state).toBe('requires_signin');
  expect(signedIn.state).toBe('available');
});
