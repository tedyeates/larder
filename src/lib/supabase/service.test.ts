import { describe, expect, it } from "vitest";

/**
 * `src/lib/supabase/service.ts` is guarded by `import "server-only"`, which
 * uses package.json export conditions (`react-server` vs `default`) rather
 * than a runtime check — Next.js's bundler resolves it, Vitest/Vite does
 * not. That means importing the module here always throws, by design: it
 * proves the guard is wired up at all, but the module's actual behaviour
 * (env var validation, client construction) is exercised for real only
 * under Next's build, which `scripts/check-no-service-role-in-bundle.mjs`
 * checks after `pnpm build`.
 */
describe("service-role client guard", () => {
  it("cannot be imported outside a server-conditioned bundler", async () => {
    await expect(import("./service")).rejects.toThrow(
      /Client Component/
    );
  });
});
