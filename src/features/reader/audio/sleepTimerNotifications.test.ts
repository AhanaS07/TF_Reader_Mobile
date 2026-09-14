// Owner: Reader (Ahana).
//
// Unit tests for sleepTimerNotifications.ts, against a local override of the root __mocks__/
// expo-notifications.js stub (same "override the generic mock locally" pattern
// AudioPlayerScreen.test.tsx uses for expo-audio) so permission/scheduling outcomes are
// controllable per test rather than fixed to the generic mock's always-granted default.
//
// Mutates the real Platform.OS directly rather than jest.mock('react-native', ...) — same
// reasoning as ttsRate.test.ts/ttsProgress.test.ts in accessibility/tts/: Platform.OS is read at
// CALL time here (not module load), so no import-order hazard, just a property flip per test.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  _resetSleepTimerNotificationsForTests,
  cancelSleepTimerNotification,
  configureSleepTimerNotificationChannel,
  requestSleepTimerNotificationPermission,
  scheduleSleepTimerNotification,
} from './sleepTimerNotifications';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id-1'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const mockSetChannel = Notifications.setNotificationChannelAsync as jest.MockedFunction<
  typeof Notifications.setNotificationChannelAsync
>;
const mockRequestPermissions = Notifications.requestPermissionsAsync as jest.MockedFunction<
  typeof Notifications.requestPermissionsAsync
>;
const mockScheduleNotification = Notifications.scheduleNotificationAsync as jest.MockedFunction<
  typeof Notifications.scheduleNotificationAsync
>;
const mockCancelNotification = Notifications.cancelScheduledNotificationAsync as jest.MockedFunction<
  typeof Notifications.cancelScheduledNotificationAsync
>;

beforeEach(() => {
  mockSetChannel.mockClear();
  mockRequestPermissions.mockClear();
  mockScheduleNotification.mockClear();
  mockCancelNotification.mockClear();
  mockRequestPermissions.mockResolvedValue({ status: 'granted', granted: true } as Awaited<
    ReturnType<typeof Notifications.requestPermissionsAsync>
  >);
  _resetSleepTimerNotificationsForTests();
});

afterEach(() => {
  (Platform as { OS: string }).OS = 'ios';
});

describe('configureSleepTimerNotificationChannel', () => {
  it('creates the Android channel on Android', async () => {
    (Platform as { OS: string }).OS = 'android';
    await configureSleepTimerNotificationChannel();

    expect(mockSetChannel).toHaveBeenCalledTimes(1);
    expect(mockSetChannel.mock.calls[0][0]).toBe('sleep-timer');
  });

  it('is a no-op on iOS, which has no channel concept', async () => {
    (Platform as { OS: string }).OS = 'ios';
    await configureSleepTimerNotificationChannel();

    expect(mockSetChannel).not.toHaveBeenCalled();
  });
});

describe('requestSleepTimerNotificationPermission', () => {
  it('resolves true when the OS grants permission', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'granted', granted: true } as Awaited<
      ReturnType<typeof Notifications.requestPermissionsAsync>
    >);
    await expect(requestSleepTimerNotificationPermission()).resolves.toBe(true);
  });

  it('resolves false when the OS denies permission', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'denied', granted: false } as Awaited<
      ReturnType<typeof Notifications.requestPermissionsAsync>
    >);
    await expect(requestSleepTimerNotificationPermission()).resolves.toBe(false);
  });
});

describe('scheduleSleepTimerNotification', () => {
  it('schedules a one-shot notification with the right title/body when permission is granted', async () => {
    const fireDate = new Date(Date.now() + 60_000);
    await scheduleSleepTimerNotification(fireDate);

    expect(mockScheduleNotification).toHaveBeenCalledTimes(1);
    const call = mockScheduleNotification.mock.calls[0][0];
    expect(call.content.title).toBe('Sleep Timer');
    expect(call.content.body).toBe('Sleep timer is over — audio has been paused.');
  });

  it('never blocks/throws on a denied permission — it just schedules nothing (SLEEP_TIMER_PLAN.md §9)', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'denied', granted: false } as Awaited<
      ReturnType<typeof Notifications.requestPermissionsAsync>
    >);

    await expect(scheduleSleepTimerNotification(new Date())).resolves.toBeUndefined();
    expect(mockScheduleNotification).not.toHaveBeenCalled();
  });

  it('cancels any previously-scheduled notification before scheduling the new one', async () => {
    await scheduleSleepTimerNotification(new Date(Date.now() + 30_000));
    mockCancelNotification.mockClear();

    await scheduleSleepTimerNotification(new Date(Date.now() + 300_000));

    expect(mockCancelNotification).toHaveBeenCalledWith('notif-id-1');
    expect(mockScheduleNotification).toHaveBeenCalledTimes(2);
  });
});

describe('cancelSleepTimerNotification', () => {
  it('cancels the pending notification and no-ops on a second call', async () => {
    await scheduleSleepTimerNotification(new Date(Date.now() + 30_000));
    mockCancelNotification.mockClear();

    await cancelSleepTimerNotification();
    expect(mockCancelNotification).toHaveBeenCalledWith('notif-id-1');

    mockCancelNotification.mockClear();
    await cancelSleepTimerNotification();
    expect(mockCancelNotification).not.toHaveBeenCalled();
  });

  it('is a safe no-op when nothing was ever scheduled', async () => {
    await expect(cancelSleepTimerNotification()).resolves.toBeUndefined();
    expect(mockCancelNotification).not.toHaveBeenCalled();
  });
});
