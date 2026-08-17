// src/shared/eventBus.ts
// The one cross-capability event bus instance.
//
// Owner note: `src/shared/` is Ahana's (lead). This file is here rather than in
// `src/features/sync/` for a structural reason, not convenience: the whole point of the bus is
// that Sync must not import Encryption to tell it a licence was revoked, and Encryption must not
// import Sync to ask. If the instance lived in either feature the other would have to reach
// across a module boundary to reach it, which is exactly what the boundary exists to prevent.
// It is deliberately tiny and has no feature-specific knowledge. Flagged for review.
//
// The SHAPE is frozen in `contracts/event-bus.ts` — channels, payloads, and the three properties
// this implementation owes. This file only provides the instance.

import type {
  EventBus,
  EventHandler,
  EventPayloads,
  Unsubscribe,
} from './contracts/event-bus';

type AnyHandler = (payload: never) => void;

/**
 * Handlers per channel, in subscription order.
 *
 * A Set would dedupe, which sounds nice and is wrong: the same function subscribed twice is two
 * intentional subscriptions (two components, one shared callback), and unsubscribing one must not
 * silently kill the other. An array plus identity-based removal of ONE entry gets that right.
 */
const handlers = new Map<keyof EventPayloads, AnyHandler[]>();

function createEventBus(): EventBus {
  return {
    /**
     * NEVER throws to its caller.
     *
     * A subscriber that throws must not fail the sync run that announced the event — Sync's job
     * is done at the point it emits, and an event is a statement of fact, not a request. The
     * error is reported and delivery continues to the remaining handlers, so one bad subscriber
     * cannot starve the others.
     *
     * Delivery is synchronous and iterates a COPY of the handler list: a handler that
     * unsubscribes (or subscribes) during dispatch would otherwise mutate the array being walked
     * and skip its neighbour.
     */
    emit<C extends keyof EventPayloads>(channel: C, payload: EventPayloads[C]): void {
      const listeners = handlers.get(channel);
      if (!listeners || listeners.length === 0) return;

      for (const handler of [...listeners]) {
        try {
          (handler as EventHandler<C>)(payload);
        } catch (error) {
          // Deliberately console, not a rethrow. There is no caller who can act on another
          // module's handler failing, and swallowing it silently would make a dead subscriber
          // indistinguishable from a working one.
          console.error(`[eventBus] handler for "${String(channel)}" threw`, error);
        }
      }
    },

    on<C extends keyof EventPayloads>(channel: C, handler: EventHandler<C>): Unsubscribe {
      const listeners = handlers.get(channel) ?? [];
      listeners.push(handler as AnyHandler);
      handlers.set(channel, listeners);

      let removed = false;
      return () => {
        // Idempotent: calling the returned function twice must not remove someone else's
        // handler that happens to sit at the same index by then.
        if (removed) return;
        removed = true;
        const current = handlers.get(channel);
        if (!current) return;
        const index = current.indexOf(handler as AnyHandler);
        if (index !== -1) current.splice(index, 1);
      };
    },

    once<C extends keyof EventPayloads>(channel: C, handler: EventHandler<C>): Unsubscribe {
      const unsubscribe = this.on(channel, ((payload: EventPayloads[C]) => {
        // Unsubscribe FIRST, so a handler that throws still detaches rather than firing again.
        unsubscribe();
        handler(payload);
      }) as EventHandler<C>);
      return unsubscribe;
    },
  };
}

/**
 * Module singleton.
 *
 * No replay and no buffering, per the contract: a subscriber that attaches late has missed the
 * event by design. Current state lives in SQLite; the event only says "now would be a good time
 * to look". Buffering would quietly turn this into a second copy of the database.
 */
export const eventBus: EventBus = createEventBus();

/**
 * Drops every subscription. TEST-ONLY.
 *
 * The singleton outlives an individual test, so a handler registered in one case would still be
 * attached in the next and see its events. Production code has no reason to call this - a
 * component detaches by calling its own unsubscribe, not by clearing everyone else's.
 */
export function resetEventBusForTests(): void {
  handlers.clear();
}
