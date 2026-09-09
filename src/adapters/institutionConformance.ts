// src/adapters/institutionConformance.ts
// The shared conformance suite for the institution half of the seam.
//
// Same reasoning as conformance.ts: one suite, run against every implementation,
// so "MockAdapter and ApiAdapter are interchangeable" is enforced by the build
// rather than asserted in a comment. The Foundation Spec names this explicitly —
// "ApiAdapter must pass the identical suite in Week 3 before it is wired up."
//
// Not a .test.ts file: jest must not collect it on its own.
import type { InstitutionSource } from '@adapters/InstitutionSource';
import { CatalogueError, isCatalogueFailure } from '@model/errors';

// The institution the catalogue fixtures belong to, so a conforming source can
// always be drilled into.
export const KNOWN_INSTITUTION_ID = 'inst_7f3';

export function describeInstitutionSourceConformance(
  name: string,
  createSource: () => InstitutionSource,
): void {
  describe(`${name} conforms to InstitutionSource`, () => {
    describe('getInstitutions', () => {
      it('returns a non-empty list', async () => {
        const institutions = await createSource().getInstitutions();

        expect(Array.isArray(institutions)).toBe(true);
        expect(institutions.length).toBeGreaterThan(0);
      });

      it('gives every institution the fields the row renders', async () => {
        const institutions = await createSource().getInstitutions();

        for (const institution of institutions) {
          expect(institution.id.length).toBeGreaterThan(0);
          expect(institution.name.length).toBeGreaterThan(0);
          expect(institution.country.length).toBeGreaterThan(0);
        }
      });

      it('gives every institution the required fields', async () => {
        const institutions = await createSource().getInstitutions();

        for (const institution of institutions) {
          expect(institution.code.length).toBeGreaterThan(0);
          expect(institution.city.length).toBeGreaterThan(0);
        }
      });

      it('never returns an empty-string catalogueUrl, only absent or usable', async () => {
        const institutions = await createSource().getInstitutions();

        for (const institution of institutions) {
          if (institution.catalogueUrl !== undefined) {
            expect(institution.catalogueUrl.length).toBeGreaterThan(0);
          }
        }
      });

      it('never returns an empty-string logoUrl inside branding, only absent or usable', async () => {
        const institutions = await createSource().getInstitutions();

        for (const institution of institutions) {
          // '' would make the row attempt an image load instead of taking the
          // initials fallback (W-17).
          if (institution.branding !== undefined) {
            expect(institution.branding.logoUrl.length).toBeGreaterThan(0);
          }
        }
      });

      it('returns unique ids, since selection is keyed by id', async () => {
        const institutions = await createSource().getInstitutions();

        expect(new Set(institutions.map((i) => i.id)).size).toBe(institutions.length);
      });
    });

    describe('getInstitution', () => {
      it('returns the institution that was asked for', async () => {
        const institution = await createSource().getInstitution(KNOWN_INSTITUTION_ID);

        expect(institution.id).toBe(KNOWN_INSTITUTION_ID);
        expect(institution.name.length).toBeGreaterThan(0);
      });

      it('agrees with the entry in the list', async () => {
        const source = createSource();

        const [fromList] = (await source.getInstitutions()).filter(
          (i) => i.id === KNOWN_INSTITUTION_ID,
        );
        const direct = await source.getInstitution(KNOWN_INSTITUTION_ID);

        // A list and a detail fetch disagreeing is the drift this suite exists to
        // catch — the picker would show one name and the header another.
        expect(direct).toEqual(fromList);
      });

      it('resolves every institution the list advertises', async () => {
        const source = createSource();
        const institutions = await source.getInstitutions();

        // No row in the picker may be a dead end.
        for (const listed of institutions) {
          expect((await source.getInstitution(listed.id)).id).toBe(listed.id);
        }
      });

      it('rejects an unknown id rather than resolving undefined', async () => {
        let caught: unknown;
        try {
          await createSource().getInstitution('inst_does_not_exist');
        } catch (err) {
          caught = err;
        }

        // The Foundation Spec calls this out by name: "rejects an unknown id
        // rather than returning undefined".
        expect(caught).toBeDefined();
        expect(isCatalogueFailure(caught)).toBe(true);
        expect((caught as { code: CatalogueError }).code).toBe(CatalogueError.NOT_FOUND);
      });
    });
  });
}
