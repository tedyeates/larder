/**
 * pg 8 aliases `sslmode=require` to `verify-full` but warns that a future major
 * will adopt weaker libpq semantics. Neon serves valid certificates, so ask for
 * verify-full explicitly: same behaviour, no warning, and it stays verified
 * after the pg upgrade.
 */
export function verifiedConnectionString(url: string): string {
  return url.replace(/([?&])sslmode=(require|prefer|verify-ca)(?=&|$)/, "$1sslmode=verify-full");
}
