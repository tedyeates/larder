import { createNeonAuth } from "@neon/auth/next/server";

/**
 * Managed Better Auth. The auth server is hosted by Neon; this module is the
 * same-origin proxy the browser talks to, so no auth secrets reach the client.
 */

const baseUrl = process.env.NEON_AUTH_BASE_URL;
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;

if (!baseUrl) throw new Error("NEON_AUTH_BASE_URL is not set");
if (!cookieSecret) throw new Error("NEON_AUTH_COOKIE_SECRET is not set");

export const auth = createNeonAuth({
  baseUrl,
  cookies: { secret: cookieSecret },
});
