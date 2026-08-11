import { afterEach, describe, expect, it, vi } from "vitest";
import { agentRunnerUrl, isAgentRunnerConfigured } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("Agent Runner configuration", () => {
  it("is disabled without a URL or with an invalid URL", () => {
    vi.stubEnv("AGENT_RUNNER_URL", "");
    expect(agentRunnerUrl()).toBeNull();
    expect(isAgentRunnerConfigured()).toBe(false);

    vi.stubEnv("AGENT_RUNNER_URL", "not a URL");
    expect(agentRunnerUrl()).toBeNull();
  });

  it("normalizes a configured runner URL", () => {
    vi.stubEnv("AGENT_RUNNER_URL", "http://runner.local:8080/");
    expect(agentRunnerUrl()).toBe("http://runner.local:8080");
    expect(isAgentRunnerConfigured()).toBe(true);
  });
});
