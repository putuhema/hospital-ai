/**
 * The hospital's public address. The editor saves to the database and
 * visitors open the hospital at / or at /m/<slug>, which printed QR signs use.
 */
export const publicUrl = (slug: string, origin = location.origin) => `${origin}/m/${slug}`;
