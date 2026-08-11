# team1_README — team1 · CAP-2 & CAP-3, Discovery & Selection

Scope note: this file covers **team1's work** — capabilities, structure, ownership, the contract,
and the constraints specific to discovery and selection. The root `README.md` covers **repo-wide**
concerns that apply to anyone working in this tree: toolchain, setup, branch model, PR process.
Read the root one first; nothing here restates it.

## Capabilities

team1 owns **CAP-2** (institution listing) and **CAP-3** (institute selection) — "Discovery &
Selection".

## Structure

`src/features/` belongs to t4targaryen (see [`T4_Readme.md`](T4_Readme.md)). Everything else under
`src/` is team1's:

```
src/
  theme/        design tokens — the only source of colour/size/spacing/radius
  model/        types.ts (THE contract), validate.ts, fixtures/
  adapters/     MockAdapter, ApiAdapter, conformance suite
  access/       resolveAccess — the ONLY place access logic may live
  components/   the shared library, one folder per component
  screens/      catalogue · search · institution · detail · library · profile
  search/       catalogue and institution pipelines + the shared shell
  store/        Zustand — in-memory state (session, selection, pending intent)
  storage/      AsyncStorage behind an interface we own — survives restart
  navigation/   RootNavigator, tabs
  hooks/        useNetworkStatus
  gallery/      the /gallery review route
  config/       env + build config — where Mock vs Api is selected
  utils/        pure helpers, no feature knowledge
docs/           team1's conventions + dependency board
```

Subfolders get created as the work lands. Folders are tracked by an empty `.gitkeep`.

**Three rules that hold the tree together:**

1. **Props in, callbacks out.** A component receives data and emits events. It does not
   fetch, read a store, navigate, or compute access. (Design Spec §5.1: _the UI must never
   calculate access rights_.)
2. **No raw values.** Every colour, size, spacing and radius comes from `src/theme`. A raw
   hex in `src/components/` fails review.
3. **A feature may not introduce a component.** If a feature needs something the library
   lacks, it is added _to the library_, reviewed by that component's original author — never
   inside a feature folder. The rule being protected is _one implementation, one location_.

The full component rules live in [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md), and a PR touching
`src/components/` is checked against them.

## Owner map

| Area                                                    | Owner                          |
| ------------------------------------------------------- | ------------------------------ |
| Repository scaffold (P0-1)                              | Prayas                         |
| Design tokens (P0-2)                                    | Khushi — single author         |
| The contract, `src/model/types.ts` (P0-3)               | Akriti                         |
| Fixtures, `validate.ts`, adapters + conformance (P0-4)  | Prayas                         |
| Component conventions + gallery route (P0-5)            | Khushi                         |
| App shell and navigation (P0-6)                         | Keshav, paired with Khushi     |
| Institutions                                            | Keshav                         |
| Search shell and matching                               | Moktik                         |
| Access spine — `resolveAccess`                          | Akriti                         |
| Section 09 dispatch + Week 1 coordination (P0-8)        | Akriti                         |

The 21-component library is a five-way split, not a single author: Prayas 5, Khushi 5, Keshav 4
(including the shell component), Akriti 3, Moktik 3.

## The contract

`src/model/types.ts` is the single contract. Four people code against it, and it is also the
artefact attached to the Section 09 question sets — so it goes out to wokay and flambeau as-is.

Two things carry their own weight, because the compiler cannot check data that arrives at runtime:

| Risk | Control |
|---|---|
| A malformed fixture, or a real API response that does not match the contract | `src/model/validate.ts` — asserts on load, throws loudly in dev |
| Mock and real adapters drifting in *behaviour* rather than shape | The adapter conformance suite. Shape is the compiler's job now; behaviour is still the suite's |

`MockAdapter implements DataAdapter` and `ApiAdapter implements DataAdapter` are compiler-checked,
which is what makes the Week 4 claim "integration is a configuration change" true rather than
hopeful.

**The frozen samples are the contract.** `wokay_docs/frozen/` holds three real OPDS responses,
confirmed by wokay on 11 Aug as "whatever is in the samples is latest". Where wokay's source-of-
truth document disagrees with a sample, the sample wins — two fields taken from that document
(`accessTier` and a flat `isbn`) turned out not to exist at all.

## Cross-team contracts

Two things in this tree are **cross-team contracts**, not just our code. Add the other team's lead
as a reviewer when you touch them:

- **The institution shape** — `Institution` in `src/model/types.ts`, shaped by **wokay**. It is
  also the one shape in that file with no sample behind it; it is hand-written from wokay's field
  names and their endpoints land Week 2.
- **Auth routing** — hands `institutionId` into **flambeau**'s sign-in flow.

## Planning docs

The authoritative docs live in the separate `team1-docs` repo: `final_plan.docx` (Delivery
Plan v2), `TF_Reader_Week1_Foundation_Spec.md` (Week 1 per person, per day),
`TF_Reader_Design_Specification.md`, `GITHUB_WORKFLOW_AND_CICD.md`.

Where the Foundation Spec and **Section 05** of the delivery plan disagree, the Foundation
Spec is correct: Section 05 says Khushi owns the top ten components, three other sections
say a five-way split. Section 05 is the outlier and is stale.

## Unratified — do not build as if these are settled

| Item | Question | Build so that… |
|---|---|---|
| **L-2** | Is the post-sign-in catalogue scoped by entitlement? Contradicts Design Spec §4.1, a signed document. | scope is config, not branching logic |
| **L-3** | Final action vocabulary — `Buy` removed, `borrow` redefined, `subscribe` B2C-only | variants come off the `ActionId` union |
| **L-5** | Three feed tabs, or one merged list? | tabs are **data, not code** |
| **Q-D** | ✅ **CLOSED 11 Aug — there is no `accessTier` field and there will not be one.** Derive the tier from the acquisition link's `licenceModel`: `UNLIMITED` → Subscription, `CONCURRENT` → Elite, key absent → Open Access. wokay's own mapping. | derived in the adapter, never in a component — see `src/model/types.ts` |
| **Q-12** | **NEW** — with no tier field, is `?accessTier=` still a valid filter parameter, or are the filter chips content-type only? | ask wokay; Moktik builds `FilterChip` on Day 3 |
| **Q-1b** | `@type` values for journal and article. `schema.org/Book` and `/Audiobook` are confirmed; the other two are our guess. | an unmapped `@type` falls back to the heuristic, never throws |

Also open: who is team1's lead, and whether team1 owns any backend module at all.

## Branch naming

Repo-wide branch rules are in the root README. team1's branches name their capability:

```
feature/CAP-2-institution-list     fix/CAP-3-selection-persist
feature/CAP-3-select-institution   chore/ci-cache
```
