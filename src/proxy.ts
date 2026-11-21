import { auth } from "@/lib/auth/server";

/**
 * Next 16 middleware lives in proxy.ts. Everything is protected except the
 * auth views, which the SDK treats as public by default.
 */
export default auth.middleware({
  loginUrl: "/auth/sign-in",
  // /api/mcp authenticates with its own bearer token; the skill and agent
  // instructions are public documents with no secrets in them.
  publicRoutes: [
    "/",
    "/auth/sign-in",
    "/api/mcp",
    "/api/integrations/ticktick/callback",
    "/prompts",
    "/skills",
  ],
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
