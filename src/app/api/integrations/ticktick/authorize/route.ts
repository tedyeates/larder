import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appOrigin, tickTickRedirectUri } from "@/lib/app-url";
import { auth } from "@/lib/auth/server";
import { getTickTickSettings, TICKTICK_SCOPE } from "@/lib/ticktick";
import { getOrCreateAppUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "larder_ticktick_state";

export async function GET(): Promise<Response> {
  const origin = await appOrigin();
  const settingsUrl = new URL("/settings/ticktick", origin);

  const { data: session } = await auth.getSession();
  if (!session?.user) return NextResponse.redirect(new URL("/auth/sign-in", origin));

  const user = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  const settings = await getTickTickSettings(user.id);
  if (!settings?.clientId || !settings.clientSecret) {
    settingsUrl.searchParams.set("error", "missing-credentials");
    return NextResponse.redirect(settingsUrl);
  }

  const state = randomBytes(24).toString("base64url");
  const cookieStore = await cookies();
  // The callback may arrive as a cross-site top-level navigation, where a
  // strict auth cookie is not sent. Bind the user to the state cookie instead.
  cookieStore.set(STATE_COOKIE, `${state}:${user.id}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 600,
  });

  const authorize = new URL("https://ticktick.com/oauth/authorize");
  authorize.searchParams.set("client_id", settings.clientId);
  authorize.searchParams.set("redirect_uri", tickTickRedirectUri(origin));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", TICKTICK_SCOPE);
  authorize.searchParams.set("state", state);

  return NextResponse.redirect(authorize);
}
