import { describe, expect, it } from "vitest";
import { buildServiceRoleClient } from "./service-role-client";

describe("buildServiceRoleClient", () => {
  it("throws when SUPABASE_SERVICE_ROLE_KEY is not set", () => {
    expect(() =>
      buildServiceRoleClient({
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      })
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is not set", () => {
    expect(() =>
      buildServiceRoleClient({
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      })
    ).toThrow();
  });

  it("constructs a client when both are set", () => {
    expect(() =>
      buildServiceRoleClient({
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      })
    ).not.toThrow();
  });
});
