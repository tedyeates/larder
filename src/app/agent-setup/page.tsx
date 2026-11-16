import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { CopyBlock } from "@/components/copy-block";
import { auth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function AgentSetupPage() {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.");
  const base = `${isLocal ? "http" : "https"}://${host}`;
  const token = process.env.LARDER_MCP_TOKEN ?? "<LARDER_MCP_TOKEN is not set>";

  const config = JSON.stringify(
    {
      mcp: {
        larder: {
          type: "remote",
          url: `${base}/api/mcp`,
          headers: { Authorization: `Bearer ${token}` },
          enabled: true,
        },
      },
    },
    null,
    2,
  );

  const prompt = `Set up the Larder pantry MCP server in this repository.

1. Save the planner skill so it loads in future sessions:
   mkdir -p .opencode/skills/larder-planner
   curl -fsSL ${base}/skills/larder-planner/SKILL.md -o .opencode/skills/larder-planner/SKILL.md

2. Merge this into opencode.json (do not replace existing keys):
${config}

3. Restart OpenCode, then call the "list_pantry" tool to verify the connection.
   Report how many ingredients are in stock and list anything expiring within 3 days.

The full setup notes are at ${base}/prompts/agent-setup.md`;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-5 pt-8 pb-28 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Connect an agent</h1>
        <p className="text-sm text-neutral-500">
          Larder exposes a read-only MCP server. Give an agent this prompt and it will install the
          skill, wire the server, and check the connection.
        </p>
      </header>

      <CopyBlock title="Paste this into OpenCode" code={prompt} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium">What the agent gets</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
          <li>
            <code>list_pantry</code>, <code>expiring_soon</code>, <code>list_leftovers</code>
          </li>
          <li>
            <code>get_week_plan</code>, <code>search_recipes</code>, <code>get_recipe</code>
          </li>
          <li>
            <code>propose_shopping_list</code> — calculates the shortfall, writes nothing
          </li>
          <li>
            <code>create_meal_plan</code> — writes a <strong>draft</strong> you activate in the Plan
            tab
          </li>
          <li>
            <code>list_ingredients</code>, <code>create_ingredient</code>,{" "}
            <code>create_recipe</code> — so it can save a recipe it found online, after you approve
            it
          </li>
        </ul>
        <p className="text-sm text-neutral-500">
          Everything else is human-only: cooking, ticking shopping items, adjusting stock. A model
          can propose and save recipes; only you confirm what left the pantry.
        </p>
      </section>

      <CopyBlock
        title="opencode.json (if you prefer to wire it yourself)"
        code={config}
        language="json"
      />

      <CopyBlock title="Bearer token — treat it like a password" code={token} secret />

      <section className="space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Files</h2>
        <p>
          Skill: <code>{base}/skills/larder-planner/SKILL.md</code>
        </p>
        <p>
          Setup notes for an agent: <code>{base}/prompts/agent-setup.md</code>
        </p>
        <p>
          Revoke by changing <code>LARDER_MCP_TOKEN</code> in the environment and restarting.
        </p>
      </section>

      <AppNav />
    </main>
  );
}
