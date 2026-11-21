"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth/server";
import {
  disconnectTickTick,
  getTickTickSettings,
  saveTickTickCredentials,
  saveTickTickProject,
  syncTickTick,
  type TickTickSyncResult,
} from "@/lib/ticktick";
import { getOrCreateAppUser } from "@/lib/users";

export interface TickTickActionResult {
  readonly error?: string;
  readonly message?: string;
}

async function context() {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  return getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
}

const credentialsInput = z.object({
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().max(400).optional(),
});

export async function saveTickTickCredentialsAction(raw: unknown): Promise<TickTickActionResult> {
  const parsed = credentialsInput.safeParse(raw);
  if (!parsed.success) return { error: "Enter the TickTick client ID and secret." };

  const user = await context();
  if (!user) return { error: "You are signed out." };

  const existing = await getTickTickSettings(user.id);
  if (!parsed.data.clientSecret && !existing?.clientSecret) {
    return { error: "Enter the TickTick client secret." };
  }
  if (existing && existing.clientId !== parsed.data.clientId && !parsed.data.clientSecret) {
    return { error: "Enter the secret for the new client ID." };
  }

  await saveTickTickCredentials(
    user.id,
    parsed.data.clientId,
    parsed.data.clientSecret === "" ? undefined : parsed.data.clientSecret,
  );
  revalidatePath("/settings/ticktick");

  const credentialsChanged =
    !existing ||
    existing.clientId !== parsed.data.clientId ||
    (parsed.data.clientSecret !== undefined &&
      parsed.data.clientSecret !== "" &&
      parsed.data.clientSecret !== existing.clientSecret);

  return {
    message: credentialsChanged
      ? "Credentials saved. Connect TickTick again to authorise them."
      : "Credentials saved.",
  };
}

const projectInput = z.object({
  projectId: z.string().trim().min(1).max(100),
  projectName: z.string().trim().min(1).max(200),
});

export async function saveTickTickProjectAction(raw: unknown): Promise<TickTickActionResult> {
  const parsed = projectInput.safeParse(raw);
  if (!parsed.success) return { error: "Choose a TickTick list." };

  const user = await context();
  if (!user) return { error: "You are signed out." };

  const settings = await getTickTickSettings(user.id);
  if (!settings?.accessToken) return { error: "Connect TickTick first." };

  await saveTickTickProject(user.id, parsed.data.projectId, parsed.data.projectName);
  revalidatePath("/settings/ticktick");
  return { message: `Shopping items will sync to ${parsed.data.projectName}.` };
}

export async function syncTickTickAction(): Promise<TickTickSyncResult> {
  const user = await context();
  if (!user) return { created: 0, updated: 0, completed: 0, error: "You are signed out." };

  try {
    const result = await syncTickTick(user.id);
    revalidatePath("/shop");
    revalidatePath("/pantry");
    revalidatePath("/settings/ticktick");
    return result;
  } catch (error) {
    return {
      created: 0,
      updated: 0,
      completed: 0,
      error: error instanceof Error ? error.message : "TickTick sync failed.",
    };
  }
}

export async function disconnectTickTickAction(): Promise<TickTickActionResult> {
  const user = await context();
  if (!user) return { error: "You are signed out." };

  await disconnectTickTick(user.id);
  revalidatePath("/settings/ticktick");
  return { message: "TickTick disconnected." };
}
