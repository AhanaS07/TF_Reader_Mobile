// src/utils/initials.ts
// Third caller (ProfileScreen's identity card, alongside InstitutionRow and
// InstitutionDetailView) is the promote-to-shared-util line both of those
// files' own comments already named in advance.

// Takes the first letter of each of the first two words.
// "Imperial College London" → "IC", "Kwame Nkrumah Uni..." → "KN"
export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}
