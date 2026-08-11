import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PlannerPage from "./page";

vi.mock("@/components/planner-chat", () => ({ PlannerChat: () => <p>Planner chat</p> }));

afterEach(() => vi.unstubAllEnvs());

describe("PlannerPage", () => {
  it("renders no planning UI when no Agent Runner is configured", () => {
    vi.stubEnv("AGENT_RUNNER_URL", "");
    const view = render(<PlannerPage />);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("renders chat when a runner URL is configured", () => {
    vi.stubEnv("AGENT_RUNNER_URL", "http://runner.test");
    render(<PlannerPage />);
    expect(screen.getByText("Planner chat")).toBeInTheDocument();
  });
});
