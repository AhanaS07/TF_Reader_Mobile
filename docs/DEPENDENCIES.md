# Dependency board — the access spine

What the access work is waiting on, and what has been decided. The board the root
README promises. Access only — other capabilities own their own rows.

## Waiting on someone else

| Who | What we need | Why it matters | Built meanwhile |
|---|---|---|---|
| **flambeau** | The four licence calls — generate, check, revoke, join queue — and their error codes | Every tier but Open Access goes through at least two of the four. This is the whole of the access block now, not a part of it. | `ActionButton` and `ActionBar` are done and know nothing about licences. The calls sit behind `resolveAccess`, which is Week 2. |
| **flambeau** | How a queue offer reaches the app, and how long it stands before expiring | Push, socket or polling are three different jobs and only polling is entirely ours. Decides whether the notification is Week 2 or Week 3. | Build against a fake trigger — a gallery button that fires an offer — so the transport is wired last, not first. |
| **flambeau** | Does `Availability.queuePosition` actually arrive? | It is the only field on that call with a job left, now that seat counts decide no buttons. Without it a queued reader cannot be told where they stand. | The field is already in the contract, unused. |
| **Design** | A mockup for **Revoke licence** | Nothing in the eighteen screens covers it. Currently built as coloured text on its own line, on Akriti's call — the reasoning is that it is the one button that takes something away from the reader. | Shipped as described. A design answer changes one line in `ActionButton`'s table. |
| **Design** | A mockup and Accept/Reject copy for the **queue notification** | A new component either way, so agree the shape before it is built. | Not started. Khushi owns it (`QueueNotification`, added Week 2). |
| **Leadership** | Ratify the licence flow; ratify that the logged-out feed is open-access only | Three rule sets are in circulation — the signed spec, wokay's correction, and the current table. Until one is ratified, two of the three produce a wrong demo. | The current table is what is built. |

## Decided — 13 August

Recorded here so nobody re-asks, and so anyone building from the signed
specification knows it is superseded.

| Question | Answer | What it cost |
|---|---|---|
| Final action vocabulary | `read` · `download` · `addToQueue` · `revokeLicence` · `subscribe` · `signIn`. `borrow` is gone **as a button** — it survives only as the OPDS wire rel on `AcquisitionRel`. | One line in `ACTION_IDS`. Nothing consumed it yet. |
| May `ELITE` Download? | **No.** Elite is read-only: `addToQueue`, then `read` + `revokeLicence` once a licence is held. No offline copy at any point. | One branch in `resolveAccess`, when it lands. Zero components. |
| Does Elite queue when a seat is free? | **Yes, always.** The queue is the only way in. | Deleted the `no_seats` state and the `availability` dependency. An Elite item now resolves the same on a list as on the detail screen. |
| B2C / `subscribe` | It is the B2C entry point. After subscribing, titles inside the reader's licence resolve to `read` + `download`. The payment surface stays wokay's. | Nothing. The button already existed. |
| `accessTier` as a field | There is none and there will not be one. Derive from `licenceModel` in the adapter: `UNLIMITED` → Subscription, `CONCURRENT` → Elite, absent → Open Access. | Already done — see `src/model/types.ts`. |
| `canPersist` vs Download | **Moot.** It maps to `CONCURRENT`, which is Elite, which no longer offers a Download to hide. The rule is honoured anyway (`canPersist: false` hides Download whatever the tier) so the read order stops mattering. | Nothing. |

**One consequence worth re-reading before the demo:** an Elite reader now has no
route to an offline copy, and waits in a queue even when a seat is empty. Both are
deliberate. Screen 18 already printed "No offline copy" under the Elite card, so
the design was ahead of the rule.
