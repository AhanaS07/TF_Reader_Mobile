// A1 — what the CatalogueHome route renders, and the one place that choice is made.
//
// Two entry points into the app share this route: a reader with an institution
// gets that institution's home catalogue, and a reader without one gets the flat
// open access feed. They are different screens rather than one screen with a
// flag, because a home catalogue and a flat list share no layout.
//
// SAFE TO READ `selectedInstitution` DIRECTLY: RootNavigator renders a splash
// until the store has rehydrated, so by the time this mounts the persisted
// selection has already arrived. Without that gate a returning reader would see
// the public catalogue flash on every launch.
import CatalogueScreen from './CatalogueScreen';
import PublicCatalogueScreen from './PublicCatalogueScreen';
import { useInstitutionStore } from '@store/institutionStore';

export default function CatalogueHomeScreen() {
  const selectedInstitution = useInstitutionStore((s) => s.selectedInstitution);

  if (selectedInstitution === null) {
    return <PublicCatalogueScreen />;
  }

  // Passed down rather than read again below, so CatalogueScreen has no reason
  // to keep a fallback id for the case this branch already ruled out.
  return <CatalogueScreen institution={selectedInstitution} />;
}
