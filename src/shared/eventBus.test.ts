// The three properties event-bus.ts declares as contract rather than choices:
//   1. emit NEVER throws to its caller.
//   2. Delivery is synchronous and ordered per channel.
//   3. No replay, no buffering.
//
// These matter because Sync emits on the bus at the end of a sync run. A subscriber that throws
// must not fail that run, and a late subscriber must not receive a stale revocation.

import { EVENT_CHANNELS, OFFLINE_LOCK_EVENTS } from './contracts';
import type { LockSignal } from './contracts';
import { eventBus, resetEventBusForTests } from './eventBus';

const lockSignal = (bookId: string): LockSignal => ({
  type: OFFLINE_LOCK_EVENTS.LOCK,
  bookId,
  reason: 'revoked',
  observedAt: 1_755_000_000_000,
});

beforeEach(resetEventBusForTests);

describe('emit / on', () => {
  it('delivers a payload to a subscriber', () => {
    const seen: LockSignal[] = [];
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, (p) => seen.push(p as LockSignal));

    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1'));

    expect(seen).toHaveLength(1);
    expect(seen[0].bookId).toBe('book-1');
  });

  it('is synchronous - the payload has arrived by the time emit returns', () => {
    let arrived = false;
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, () => {
      arrived = true;
    });

    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1'));

    expect(arrived).toBe(true);
  });

  it('delivers in subscription order', () => {
    const order: number[] = [];
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, () => order.push(1));
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, () => order.push(2));
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, () => order.push(3));

    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1'));

    expect(order).toEqual([1, 2, 3]);
  });

  it('preserves per-channel ordering across successive emits', () => {
    const seen: string[] = [];
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, (p) => seen.push((p as LockSignal).bookId));

    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('a'));
    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('b'));

    expect(seen).toEqual(['a', 'b']);
  });

  it('does not cross channels', () => {
    const locks: unknown[] = [];
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, (p) => locks.push(p));

    eventBus.emit(EVENT_CHANNELS.CONTENT_UNLOCK, {
      type: OFFLINE_LOCK_EVENTS.UNLOCK,
      bookId: 'book-1',
      observedAt: 1,
    });

    expect(locks).toHaveLength(0);
  });

  it('emitting on a channel with no subscribers is a no-op, not an error', () => {
    expect(() =>
      eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1')),
    ).not.toThrow();
  });

  it('keeps two identical handler references as two independent subscriptions', () => {
    // A Set would dedupe these, and unsubscribing one would silently kill the other.
    let calls = 0;
    const handler = () => {
      calls += 1;
    };
    const off = eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, handler);
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, handler);

    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1'));
    expect(calls).toBe(2);

    off();
    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1'));
    expect(calls).toBe(3); // the surviving subscription still fires
  });
});

describe('emit never throws to its caller', () => {
  it('a throwing subscriber does not fail the emitter', () => {
    // This is the one that protects the sync run: Sync's job is done at the point it emits.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, () => {
      throw new Error('subscriber exploded');
    });

    expect(() =>
      eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1')),
    ).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('a throwing subscriber does not starve the ones after it', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, () => {
      throw new Error('boom');
    });
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, () => seen.push('second'));

    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1'));

    expect(seen).toEqual(['second']);
    spy.mockRestore();
  });
});

describe('unsubscribe', () => {
  it('stops delivery', () => {
    let calls = 0;
    const off = eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, () => {
      calls += 1;
    });

    off();
    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1'));

    expect(calls).toBe(0);
  });

  it('is idempotent - calling it twice does not remove someone else', () => {
    let mine = 0;
    let theirs = 0;
    const off = eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, () => {
      mine += 1;
    });
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, () => {
      theirs += 1;
    });

    off();
    off();
    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1'));

    expect(mine).toBe(0);
    expect(theirs).toBe(1);
  });

  it('a handler that unsubscribes mid-dispatch does not skip its neighbour', () => {
    // Dispatch iterates a copy for exactly this reason.
    const seen: string[] = [];
    const off = eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, () => {
      seen.push('first');
      off();
    });
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, () => seen.push('second'));

    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1'));

    expect(seen).toEqual(['first', 'second']);
  });
});

describe('once', () => {
  it('fires exactly once', () => {
    let calls = 0;
    eventBus.once(EVENT_CHANNELS.CONTENT_LOCK, () => {
      calls += 1;
    });

    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1'));
    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-2'));

    expect(calls).toBe(1);
  });

  it('detaches even when the handler throws', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    eventBus.once(EVENT_CHANNELS.CONTENT_LOCK, () => {
      calls += 1;
      throw new Error('boom');
    });

    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1'));
    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-2'));

    expect(calls).toBe(1);
    spy.mockRestore();
  });
});

describe('no replay', () => {
  it('a late subscriber does not receive an event emitted before it attached', () => {
    // Buffering would make the bus a second copy of the database. A revocation acted on once
    // must not be re-delivered to whoever attaches next - acting means destroying key material.
    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, lockSignal('book-1'));

    const seen: unknown[] = [];
    eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, (p) => seen.push(p));

    expect(seen).toHaveLength(0);
  });
});
