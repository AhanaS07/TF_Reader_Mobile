// Owner: Download (Abhinav).
//
// BuildPlan.md Phase 3 step 1: "Permission check (app-specific storage)". App-private storage
// (expo-file-system's Paths.document, what contentStore.ts writes into) needs NO runtime OS
// permission on iOS or Android — unlike, say, MediaLibrary or Camera. This function exists as
// the NAMED SEAM the build plan asks for, not a real permission prompt: it always resolves true
// today. If a future storage location needs a real permission, this is where that check goes —
// don't remove the call site in downloadManager.ts to "simplify" it away.

export async function checkStoragePermission(): Promise<boolean> {
  return true;
}
