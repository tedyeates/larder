import { isAgentRunnerConfigured } from "@/lib/planner/config";
import { PlannerChat } from "@/components/planner-chat";

export const dynamic = "force-dynamic";

/** Runtime capability boundary: hosted deployments retain a valid empty route,
 * while navigation and all planner UI disappear when no Runner is configured. */
export default function PlannerPage() {
  if (!isAgentRunnerConfigured()) return null;
  return <PlannerChat />;
}
