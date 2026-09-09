// src/features/library/context.ts
// How the Library screen gets its `LibraryProvider` without importing any
// concrete implementation.
//
// The default is the stand-in, so the screen works today with NO provider
// mounted anywhere. At merge, wrap the Library stack (or the app root) in
// `<LibraryProviderContext.Provider value={realProvider}>` and the screen picks
// up the real sync/download/reader adapter with no change of its own. That
// wrapping is the ONLY app-root edit the merge needs — see INTEGRATION.md.
import { createContext, useContext } from 'react';

import type { LibraryProvider } from './ports';
import { standInLibraryProvider } from './standInProvider';

const LibraryProviderContext = createContext<LibraryProvider>(standInLibraryProvider);

/** The Library provider in scope — the stand-in until a real one is mounted. */
export function useLibraryProvider(): LibraryProvider {
  return useContext(LibraryProviderContext);
}

export { LibraryProviderContext };
