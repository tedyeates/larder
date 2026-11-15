import { createAuthClient } from "@neon/auth/next";

/**
 * Browser client. Takes no arguments: it calls the same-origin proxy at
 * /api/auth, which forwards to the managed auth server.
 */
export const authClient = createAuthClient();
