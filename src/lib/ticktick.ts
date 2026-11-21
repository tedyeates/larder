import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shoppingItems, shoppingLists, ticktickSettings } from "@/db/schema";
import { shoppingTaskTitle } from "@/domain/ticktick";
import { completeShoppingItem, getOpenList, getShoppingRows } from "@/lib/shop";

const API_BASE = "https://api.ticktick.com/open/v1";
const TOKEN_URL = "https://ticktick.com/oauth/token";

/** TickTick's OAuth scopes for reading and writing tasks. */
export const TICKTICK_SCOPE = "tasks:read tasks:write";

export interface TickTickSettings {
  readonly userId: string;
  readonly clientId: string | null;
  readonly clientSecret: string | null;
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly expiresAt: Date | null;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly connectedAt: Date | null;
  readonly lastSyncedAt: Date | null;
}

export interface TickTickProject {
  readonly id: string;
  readonly name: string;
  readonly color?: string | null;
  readonly closed?: boolean | null;
}

interface TickTickTask {
  readonly id: string;
  readonly projectId?: string | null;
  readonly title?: string | null;
  readonly status?: number | null;
  readonly completedTime?: string | null;
}

interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
}

export class TickTickError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TickTickError";
  }
}

function mapSettings(row: typeof ticktickSettings.$inferSelect): TickTickSettings {
  return {
    userId: row.userId,
    clientId: row.clientId,
    clientSecret: row.clientSecret,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt,
    projectId: row.projectId,
    projectName: row.projectName,
    connectedAt: row.connectedAt,
    lastSyncedAt: row.lastSyncedAt,
  };
}

export async function getTickTickSettings(userId: string): Promise<TickTickSettings | null> {
  const [row] = await getDb()
    .select()
    .from(ticktickSettings)
    .where(eq(ticktickSettings.userId, userId))
    .limit(1);
  return row ? mapSettings(row) : null;
}

export async function saveTickTickCredentials(
  userId: string,
  clientId: string,
  clientSecret?: string,
): Promise<void> {
  const existing = await getTickTickSettings(userId);
  const nextSecret = clientSecret ?? existing?.clientSecret ?? null;
  const changed =
    existing === null ||
    existing.clientId !== clientId ||
    (clientSecret !== undefined && existing.clientSecret !== clientSecret);

  await getDb()
    .insert(ticktickSettings)
    .values({
      userId,
      clientId,
      clientSecret: nextSecret,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: ticktickSettings.userId,
      set: {
        clientId,
        clientSecret: nextSecret,
        updatedAt: new Date(),
        ...(changed
          ? {
              accessToken: null,
              refreshToken: null,
              expiresAt: null,
              projectId: null,
              projectName: null,
              connectedAt: null,
            }
          : {}),
      },
    });
}

export async function saveTickTickTokens(
  userId: string,
  tokens: { accessToken: string; refreshToken: string | null; expiresAt: Date | null },
): Promise<void> {
  await getDb()
    .update(ticktickSettings)
    .set({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      connectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(ticktickSettings.userId, userId));
}

export async function saveTickTickProject(
  userId: string,
  projectId: string,
  projectName: string,
): Promise<void> {
  await getDb()
    .update(ticktickSettings)
    .set({ projectId, projectName, updatedAt: new Date() })
    .where(eq(ticktickSettings.userId, userId));
}

export async function disconnectTickTick(userId: string): Promise<void> {
  await getDb()
    .update(ticktickSettings)
    .set({
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      projectId: null,
      projectName: null,
      connectedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(ticktickSettings.userId, userId));
}

async function requestToken(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new TickTickError(
      `TickTick authentication failed (${response.status}).`,
      response.status,
    );
  }

  return (await response.json()) as TokenResponse;
}

export async function getTickTickAccessToken(userId: string): Promise<string> {
  const settings = await getTickTickSettings(userId);
  if (!settings?.accessToken) throw new TickTickError("TickTick is not connected.");

  const expiring =
    settings.expiresAt !== null && settings.expiresAt.getTime() <= Date.now() + 60_000;
  if (!expiring) return settings.accessToken;

  if (!settings.refreshToken || !settings.clientId || !settings.clientSecret) {
    throw new TickTickError("TickTick session expired. Reconnect TickTick.");
  }

  const token = await requestToken({
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    refresh_token: settings.refreshToken,
    grant_type: "refresh_token",
  });
  const expiresAt =
    token.expires_in === undefined ? null : new Date(Date.now() + token.expires_in * 1_000);

  await getDb()
    .update(ticktickSettings)
    .set({
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? settings.refreshToken,
      expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(ticktickSettings.userId, userId));

  return token.access_token;
}

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const body = await response.text();
  if (!response.ok) {
    throw new TickTickError(
      `TickTick API error (${response.status}): ${body.slice(0, 240)}`,
      response.status,
    );
  }
  return (body === "" ? undefined : JSON.parse(body)) as T;
}

export async function listTickTickProjects(userId: string): Promise<TickTickProject[]> {
  const token = await getTickTickAccessToken(userId);
  return api<TickTickProject[]>(token, "/project");
}

/** Best-effort: keep TickTick in step when the human ticks the item in Larder. */
export async function completeTickTickTaskForItem(userId: string, itemId: string): Promise<void> {
  const [row] = await getDb()
    .select({
      taskId: shoppingItems.ticktickTaskId,
      projectId: shoppingItems.ticktickProjectId,
    })
    .from(shoppingItems)
    .innerJoin(shoppingLists, eq(shoppingItems.listId, shoppingLists.id))
    .where(and(eq(shoppingItems.id, itemId), eq(shoppingLists.userId, userId)))
    .limit(1);
  if (!row?.taskId) return;

  const settings = await getTickTickSettings(userId);
  if (!settings?.accessToken) return;
  const projectId = row.projectId ?? settings.projectId;
  if (!projectId) return;

  const token = await getTickTickAccessToken(userId);
  await api(token, `/project/${projectId}/task/${row.taskId}/complete`, { method: "POST" });
}

/** Best-effort: remove the task when the human removes it from Larder. */
export async function deleteTickTickTaskForItem(userId: string, itemId: string): Promise<void> {
  const [row] = await getDb()
    .select({
      taskId: shoppingItems.ticktickTaskId,
      projectId: shoppingItems.ticktickProjectId,
    })
    .from(shoppingItems)
    .innerJoin(shoppingLists, eq(shoppingItems.listId, shoppingLists.id))
    .where(and(eq(shoppingItems.id, itemId), eq(shoppingLists.userId, userId)))
    .limit(1);
  if (!row?.taskId) return;

  const settings = await getTickTickSettings(userId);
  if (!settings?.accessToken) return;
  const projectId = row.projectId ?? settings.projectId;
  if (!projectId) return;

  const token = await getTickTickAccessToken(userId);
  await api(token, `/project/${projectId}/task/${row.taskId}`, { method: "DELETE" });
}

/** The TickTick task title carries the amount, so a list read at the shop is enough. */
function tickTickDate(date: Date): string {
  return date.toISOString().replace("Z", "+0000");
}

export interface TickTickSyncResult {
  readonly created: number;
  readonly updated: number;
  readonly completed: number;
  readonly message?: string;
  readonly error?: string;
}

/**
 * One sync button does both directions:
 * - completed TickTick tasks tick their Larder item and add stock;
 * - pending Larder items are created or refreshed as TickTick tasks.
 */
export async function syncTickTick(userId: string): Promise<TickTickSyncResult> {
  const settings = await getTickTickSettings(userId);
  if (!settings?.accessToken) {
    return { created: 0, updated: 0, completed: 0, error: "Connect TickTick first." };
  }
  if (!settings.projectId) {
    return { created: 0, updated: 0, completed: 0, error: "Choose a TickTick list first." };
  }

  const token = await getTickTickAccessToken(userId);
  const list = await getOpenList(userId);

  // Pull first: a task completed in TickTick should not be pushed again.
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const completed = await api<TickTickTask[] | { result?: TickTickTask[] } | undefined>(
    token,
    "/task/completed",
    {
      method: "POST",
      body: JSON.stringify({
        projectIds: [settings.projectId],
        startDate: tickTickDate(start),
        endDate: tickTickDate(end),
      }),
    },
  );
  const completedTasks = Array.isArray(completed) ? completed : (completed?.result ?? []);
  const completedIds = new Set(
    completedTasks
      .filter((task) => task.projectId === undefined || task.projectId === settings.projectId)
      .map((task) => task.id),
  );

  let completedCount = 0;
  const before = await getShoppingRows(list.id);
  for (const row of before) {
    if (row.status !== "pending" || !row.ticktickTaskId) continue;
    if (!completedIds.has(row.ticktickTaskId)) continue;
    const result = await completeShoppingItem(userId, row.id);
    if (!result.error) completedCount += 1;
  }

  // Then push whatever is still pending, including edits made in Larder.
  const rows = await getShoppingRows(list.id);
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    if (row.status !== "pending") continue;
    const title = shoppingTaskTitle(row);
    const content = "Larder shopping list";

    if (row.ticktickTaskId && row.ticktickProjectId === settings.projectId) {
      if (row.ticktickTitle === title) continue;
      try {
        await api(token, `/task/${row.ticktickTaskId}`, {
          method: "POST",
          body: JSON.stringify({
            id: row.ticktickTaskId,
            projectId: settings.projectId,
            title,
            content,
          }),
        });
        await getDb()
          .update(shoppingItems)
          .set({ ticktickTitle: title })
          .where(eq(shoppingItems.id, row.id));
        updated += 1;
        continue;
      } catch (error) {
        // The task was deleted in TickTick: recreate it below.
        if (!(error instanceof TickTickError) || error.status !== 404) throw error;
      }
    }

    // The chosen list changed: remove the old task rather than leaving a ghost.
    if (row.ticktickTaskId && row.ticktickProjectId) {
      try {
        await api(token, `/project/${row.ticktickProjectId}/task/${row.ticktickTaskId}`, {
          method: "DELETE",
        });
      } catch {
        // Best effort; the new task is what matters.
      }
    }

    const task = await api<{ id: string; projectId?: string | null }>(token, "/task", {
      method: "POST",
      body: JSON.stringify({ projectId: settings.projectId, title, content }),
    });

    await getDb()
      .update(shoppingItems)
      .set({
        ticktickTaskId: task.id,
        ticktickProjectId: task.projectId ?? settings.projectId,
        ticktickTitle: title,
      })
      .where(eq(shoppingItems.id, row.id));
    created += 1;
  }

  await getDb()
    .update(ticktickSettings)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(ticktickSettings.userId, userId));

  const parts = [
    created > 0 ? `${created} added` : "",
    updated > 0 ? `${updated} updated` : "",
    completedCount > 0 ? `${completedCount} bought` : "",
  ].filter((part) => part !== "");

  return {
    created,
    updated,
    completed: completedCount,
    message: parts.length > 0 ? `TickTick: ${parts.join(", ")}.` : "TickTick is already in sync.",
  };
}
