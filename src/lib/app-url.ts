import { headers } from "next/headers";

/** The public origin of the current request, including behind Vercel's proxy. */
export async function appOrigin(): Promise<string> {
  const headerList = await headers();
  const host =
    (headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000")
      .split(",")[0]
      ?.trim() ?? "localhost:3000";
  const proto =
    (
      headerList.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https")
    )
      .split(",")[0]
      ?.trim() ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function tickTickRedirectUri(origin: string): string {
  return `${origin}/api/integrations/ticktick/callback`;
}
