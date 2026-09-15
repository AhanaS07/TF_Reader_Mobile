// Owner: Accessibility (Hruthik).
//
// The gate matters more than the wording. Every `null` case below is a defect if it starts
// returning a string: the failure mode is announcing "Speaking" before every sentence in the book.

import { ttsStatusAnnouncement } from './ttsAnnouncements';

describe('ttsStatusAnnouncement', () => {
  it('announces a fresh start from idle', () => {
    expect(ttsStatusAnnouncement('idle', 'speaking')).toBe('Speaking');
  });

  it('says "Resumed", not "Speaking", when the previous status was paused', () => {
    expect(ttsStatusAnnouncement('paused', 'speaking')).toBe('Resumed');
  });

  it('announces a pause', () => {
    expect(ttsStatusAnnouncement('speaking', 'paused')).toBe('Paused');
  });

  it('announces stopping', () => {
    expect(ttsStatusAnnouncement('speaking', 'idle')).toBe('Stopped');
    expect(ttsStatusAnnouncement('paused', 'idle')).toBe('Stopped');
    expect(ttsStatusAnnouncement('error', 'idle')).toBe('Stopped');
  });

  it('says nothing for a transition into error — item 9 announces the message, not this', () => {
    expect(ttsStatusAnnouncement('speaking', 'error')).toBeNull();
  });

  it('says nothing when the status did not actually change', () => {
    expect(ttsStatusAnnouncement('speaking', 'speaking')).toBeNull();
    expect(ttsStatusAnnouncement('idle', 'idle')).toBeNull();
    expect(ttsStatusAnnouncement('paused', 'paused')).toBeNull();
    expect(ttsStatusAnnouncement('error', 'error')).toBeNull();
  });

  it('repeated speaking transitions across sentences produce exactly one announcement', () => {
    // Simulates handleTtsStart firing once per sentence while liveStatus stays 'speaking'.
    let previous: Parameters<typeof ttsStatusAnnouncement>[0] = 'idle';
    const said: (string | null)[] = [];
    for (const next of ['speaking', 'speaking', 'speaking'] as const) {
      said.push(ttsStatusAnnouncement(previous, next));
      previous = next;
    }
    expect(said).toEqual(['Speaking', null, null]);
  });
});
