import { auth } from "@/lib/auth/server";

/**
 * Next 16 middleware lives in proxy.ts. Everything is protected except the
 * auth views, which the SDK treats as public by default.
 */
export default auth.middleware({
  loginUrl: "/auth/sign-in",
  publicRoutes: ["/", "/auth/sign-in"],
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
