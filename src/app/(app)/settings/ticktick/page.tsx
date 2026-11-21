import Link from "next/link";
import { redirect } from "next/navigation";
import { TickTickSettingsForm } from "@/components/ticktick-settings";
import { appOrigin, tickTickRedirectUri } from "@/lib/app-url";
import { auth } from "@/lib/auth/server";
import { getTickTickSettings, listTickTickProjects, type TickTickProject } from "@/lib/ticktick";
import { getOrCreateAppUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  connected: "TickTick connected. Choose the list you want Larder to use.",
  "missing-credentials": "Save your TickTick client ID and secret first.",
  denied: "TickTick authorisation was cancelled.",
  state: "That authorisation link expired. Try connecting again.",
  exchange: "TickTick did not accept the authorisation. Check the client secret and redirect URI.",
};

export default async function TickTickSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const user = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  const settings = await getTickTickSettings(user.id);
  const origin = await appOrigin();
  const params = await searchParams;
  const notice: string | null = params.error
    ? (NOTICES[params.error] ?? "TickTick could not be connected.")
    : params.connected
      ? (NOTICES.connected ?? null)
      : null;

  let projects: TickTickProject[] = [];
  let projectsError: string | null = null;
  if (settings?.accessToken) {
    try {
      projects = await listTickTickProjects(user.id);
    } catch (error) {
      projectsError = error instanceof Error ? error.message : "Could not load TickTick lists.";
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-5 pt-8 pb-28 sm:px-6">
      <Link href="/shop" className="text-sm text-neutral-500 hover:underline">
        ← Shop
      </Link>

      <header className="mt-3 mb-6 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">TickTick sync</h1>
        <p className="text-sm text-neutral-500">
          Send the shopping list to a TickTick list, then tick items off there. A sync brings the
          bought items back into the pantry.
        </p>
      </header>

      <TickTickSettingsForm
        clientId={settings?.clientId ?? ""}
        hasClientSecret={Boolean(settings?.clientSecret)}
        connected={Boolean(settings?.accessToken)}
        projectId={settings?.projectId ?? ""}
        projectName={settings?.projectName ?? ""}
        projects={projects}
        projectsError={projectsError}
        redirectUri={tickTickRedirectUri(origin)}
        lastSyncedAt={settings?.lastSyncedAt?.toISOString() ?? null}
        notice={notice}
      />
    </main>
  );
}
