import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name?: string | null;
}

/**
 * Map a managed auth user onto the app's own user row.
 *
 * Larder is single-user today, so the first sign-in adopts the seeded row
 * (keeping its 119 ingredients) instead of orphaning them. When households
 * arrive, this is the seam that grows a membership table.
 */
export async function getOrCreateAppUser(authUser: AuthUser) {
  const db = getDb();

  const existing = await db.select().from(users).where(eq(users.authUserId, authUser.id)).limit(1);
  if (existing[0]) return existing[0];

  const [unclaimed] = await db
    .select()
    .from(users)
    .where(and(isNull(users.authUserId), isNull(users.email)))
    .limit(1);

  if (unclaimed) {
    const [adopted] = await db
      .update(users)
      .set({
        authUserId: authUser.id,
        email: authUser.email,
        name: authUser.name?.trim() || authUser.email,
      })
      .where(eq(users.id, unclaimed.id))
      .returning();
    if (adopted) return adopted;
  }

  const [created] = await db
    .insert(users)
    .values({
      authUserId: authUser.id,
      email: authUser.email,
      name: authUser.name?.trim() || authUser.email,
    })
    .returning();

  if (!created) throw new Error("Could not create the app user");
  return created;
}
