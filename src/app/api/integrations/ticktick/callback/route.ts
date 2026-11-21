import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appOrigin, tickTickRedirectUri } from "@/lib/app-url";
import { getTickTickSettings, saveTickTickTokens, TickTickError } from "@/lib/ticktick";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "larder_ticktick_state";

function settingsRedirect(origin: string, error?: string): NextResponse {
  const url = new URL("/settings/ticktick", origin);
  url.searchParams.set(error === undefined ? "connected" : "error", error ?? "1");
  return NextResponse.redirect(url);
}

export async function GET(request: Request): Promise<Response> {
  const origin = await appOrigin();
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error !== null) return settingsRedirect(origin, "denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  const [expectedState, userId] = cookieValue?.split(":") ?? [];
  if (!code || !state || !expectedState || !userId || state !== expectedState) {
    return settingsRedirect(origin, "state");
  }

  const settings = await getTickTickSettings(userId);
  if (!settings?.clientId || !settings.clientSecret) {
    return settingsRedirect(origin, "missing-credentials");
  }

  try {
    const response = await fetch("https://ticktick.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: tickTickRedirectUri(origin),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) throw new TickTickError(`Token exchange failed (${response.status}).`);

    const token = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!token.access_token) throw new TickTickError("TickTick did not return an access token.");

    await saveTickTickTokens(userId, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt:
        token.expires_in === undefined ? null : new Date(Date.now() + token.expires_in * 1_000),
    });
  } catch {
    return settingsRedirect(origin, "exchange");
  }

  return settingsRedirect(origin);
}
