"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  disconnectTickTickAction,
  saveTickTickCredentialsAction,
  saveTickTickProjectAction,
  syncTickTickAction,
} from "@/actions/ticktick";
import type { TickTickProject } from "@/lib/ticktick";
import { CopyBlock } from "./copy-block";

export function TickTickSettingsForm({
  clientId,
  hasClientSecret,
  connected,
  projectId,
  projectName,
  projects,
  projectsError,
  redirectUri,
  lastSyncedAt,
  notice,
}: {
  clientId: string;
  hasClientSecret: boolean;
  connected: boolean;
  projectId: string;
  projectName: string;
  projects: readonly TickTickProject[];
  projectsError: string | null;
  redirectUri: string;
  lastSyncedAt: string | null;
  notice: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [clientIdValue, setClientIdValue] = useState(clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [project, setProject] = useState(projectId);
  const [message, setMessage] = useState<string | null>(notice);
  const [error, setError] = useState<string | null>(null);

  const currentProject =
    projects.find((item) => item.id === project) ??
    (projectName && projectId ? { id: projectId, name: projectName } : null);
  const projectOptions =
    currentProject && !projects.some((item) => item.id === currentProject.id)
      ? [currentProject, ...projects]
      : projects;

  function saveCredentials() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await saveTickTickCredentialsAction({
        clientId: clientIdValue,
        clientSecret: clientSecret === "" ? undefined : clientSecret,
      });
      setMessage(result.message ?? null);
      setError(result.error ?? null);
      if (!result.error) setClientSecret("");
      router.refresh();
    });
  }

  function saveProject() {
    setError(null);
    setMessage(null);
    const selected = projectOptions.find((item) => item.id === project);
    if (!selected) {
      setError("Choose a TickTick list.");
      return;
    }
    startTransition(async () => {
      const result = await saveTickTickProjectAction({
        projectId: selected.id,
        projectName: selected.name,
      });
      setMessage(result.message ?? null);
      setError(result.error ?? null);
      router.refresh();
    });
  }

  function sync() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await syncTickTickAction();
      setMessage(result.message ?? null);
      setError(result.error ?? null);
      router.refresh();
    });
  }

  function disconnect() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await disconnectTickTickAction();
      setMessage(result.message ?? null);
      setError(result.error ?? null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {message !== null && (
        <p className="rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-900">{message}</p>
      )}
      {error !== null && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <section className="space-y-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div>
          <h2 className="text-sm font-medium">1. TickTick app</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Create an app at{" "}
            <a
              href="https://developer.ticktick.com/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              developer.ticktick.com
            </a>
            , add the redirect URI below, then paste its client ID and secret here.
          </p>
        </div>

        <CopyBlock title="Redirect URI" code={redirectUri} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Client ID</span>
            <input
              value={clientIdValue}
              onChange={(event) => setClientIdValue(event.target.value)}
              placeholder="TickTick client ID"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Client secret</span>
            <input
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder={
                hasClientSecret ? "Saved — leave blank to keep" : "TickTick client secret"
              }
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
        </div>

        <p className="text-xs text-neutral-500">
          Secrets stay server-side in your Larder database and are never sent back to this page.
        </p>

        <button
          type="button"
          onClick={saveCredentials}
          disabled={pending || clientIdValue.trim() === ""}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {pending ? "Saving…" : "Save credentials"}
        </button>

        {hasClientSecret && (
          <a
            href="/api/integrations/ticktick/authorize"
            className="inline-block rounded-lg border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
          >
            {connected ? "Reconnect TickTick" : "Connect TickTick"}
          </a>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div>
          <h2 className="text-sm font-medium">2. Choose a list</h2>
          <p className="mt-1 text-xs text-neutral-500">
            {connected
              ? "Pending shopping items go here. Ticked tasks come back to the pantry."
              : "Connect TickTick to load your lists."}
          </p>
        </div>

        {projectsError !== null && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {projectsError}
          </p>
        )}

        {connected && projectOptions.length === 0 && projectsError === null && (
          <p className="text-sm text-neutral-500">
            No lists found. Create one in TickTick, then reload this page.
          </p>
        )}

        {projectOptions.length > 0 && (
          <>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">TickTick list</span>
              <select
                value={project}
                onChange={(event) => setProject(event.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              >
                <option value="">Choose a list</option>
                {projectOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={saveProject}
              disabled={pending || project === ""}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {pending ? "Saving…" : "Save list"}
            </button>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">3. Sync</h2>
            <p className="mt-1 text-xs text-neutral-500">
              {connected && projectId
                ? `Connected${lastSyncedAt ? ` · last sync ${new Date(lastSyncedAt).toLocaleString("en-GB")}` : ""}`
                : "Connect TickTick and choose a list first."}
            </p>
          </div>
          {connected && (
            <button
              type="button"
              onClick={disconnect}
              disabled={pending}
              className="text-xs text-neutral-500 underline-offset-4 hover:underline disabled:opacity-50"
            >
              Disconnect
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={sync}
          disabled={pending || !connected || projectId === ""}
          className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {pending ? "Syncing…" : "Sync shopping list with TickTick"}
        </button>
        <p className="text-xs text-neutral-500">
          Adds or updates pending items in TickTick, then ticks off anything you completed there and
          adds it to the pantry.
        </p>
      </section>
    </div>
  );
}
