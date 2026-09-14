// Owner: Reader (Ahana).
//
// SLEEP TIMER NOTIFICATIONS. The ONLY file in this feature that imports `expo-notifications`, so
// the rest of the feature (sleepTimerStore.ts, sleepTimerEngine.ts, SleepTimerModal.tsx) stays
// testable under Jest without mocking a native module everywhere. See SLEEP_TIMER_PLAN.md §2 for
// why a real OS notification — not a hand-rolled banner — is the right mechanism here: it is the
// only thing that can paint above a locked screen or survive a suspended JS process, and it is
// what the "screen active" vs. "screen locked" split in this app's ask already maps to for free.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ANDROID_CHANNEL_ID = 'sleep-timer';

let scheduledNotificationId: string | null = null;

// MODULE LOAD, NOT A `useEffect` — a notification that fires during cold start can slip past a
// handler registered inside an effect that hasn't run yet. Importing this file early
// (useAudioPlayerSetup.ts, already called once at app root) is sufficient; no separate wiring into
// App.tsx is needed. `shouldShowBanner`/`shouldShowList`, not the deprecated `shouldShowAlert` —
// expo-notifications' default foreground behavior with no handler set is to show NOTHING on iOS,
// so this is what makes the foreground case slide in as a banner at all.
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
});

/** Android notification channel — call once at startup, alongside the existing one-time
 * `ensureAudioModeConfigured()` call in useAudioPlayerSetup.ts. A no-op on iOS, which has no
 * channel concept. */
export async function configureSleepTimerNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Sleep Timer',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** Call lazily, the first time a user actually starts a sleep timer — not at app launch, for a
 * feature they haven't touched yet. `scheduleSleepTimerNotification` is this function's only
 * caller today, which is what makes that lazy timing true in practice. */
export async function requestSleepTimerNotificationPermission(): Promise<boolean> {
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
}

/**
 * One-shot local notification for the timer's deadline. Never blocks starting the timer on
 * permission being granted — a denial just means this resolves having scheduled nothing; the
 * JS-side pause (sleepTimerEngine.ts's own setTimeout/AppState catch-up) still fires on schedule
 * regardless. See SLEEP_TIMER_PLAN.md §9's "notification permission denied" edge case.
 */
export async function scheduleSleepTimerNotification(fireDate: Date): Promise<void> {
  const granted = await requestSleepTimerNotificationPermission();
  if (!granted) return;

  await cancelSleepTimerNotification();
  scheduledNotificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Sleep Timer',
      body: 'Sleep timer is over — audio has been paused.',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireDate,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
}

/** Cancels the pending notification, if any. No-ops if none is pending. */
export async function cancelSleepTimerNotification(): Promise<void> {
  if (scheduledNotificationId === null) return;
  const id = scheduledNotificationId;
  scheduledNotificationId = null;
  await Notifications.cancelScheduledNotificationAsync(id);
}

/** Test-only reset helper, mirroring the `_reset...ForTests` convention already used elsewhere in
 * this feature (audioPlayerInstance.ts's `_resetTrackCompletionHandlerForTests`,
 * audioTtsCoordinator.ts's `_resetAudioTtsCoordinatorForTests`) — clears the module-scoped id
 * between test cases without going through a real cancel call. */
export function _resetSleepTimerNotificationsForTests(): void {
  scheduledNotificationId = null;
}
