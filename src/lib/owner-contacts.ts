// Saved sales contacts are tied to a board owner: their account id, or the
// typed owner name for owners with no account yet (migration 048).

/** The key a board owner's saved contacts are stored under, or null if no owner is known. */
export function ownerContactKey(ownerId: string | null | undefined, ownerName?: string | null): string | null {
  if (ownerId) return ownerId;
  const name = (ownerName ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return name ? `name:${name.slice(0, 200)}` : null;
}

/** Tidies a contact so the same person isn't saved twice with different spacing. */
export function cleanContact(name: string | null | undefined, phone: string | null | undefined) {
  return {
    contact_name: (name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
    contact_phone: (phone ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
  };
}
