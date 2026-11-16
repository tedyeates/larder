/**
 * Machine-readable setup notes, mirroring Neon's agent-setup prompt: an agent
 * can fetch this file and follow it without a human copying anything.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const base = `${url.protocol}//${url.host}`;

  const body = `# Larder agent setup

Official setup steps for connecting an MCP-capable agent to a Larder instance.

Complete these yourself. The only thing the human must supply is the bearer
token, which lives in the app's environment as \`LARDER_MCP_TOKEN\`.

## 1. Fetch and save the planner skill

\`\`\`bash
mkdir -p .opencode/skills/larder-planner
curl -fsSL ${base}/skills/larder-planner/SKILL.md -o .opencode/skills/larder-planner/SKILL.md
\`\`\`

## 2. Add the MCP server

Merge into \`opencode.json\` at the project or user level:

\`\`\`json
{
  "mcp": {
    "larder": {
      "type": "remote",
      "url": "${base}/api/mcp",
      "headers": { "Authorization": "Bearer <LARDER_MCP_TOKEN>" },
      "enabled": true
    }
  }
}
\`\`\`

The token is never printed by this document. On the machine hosting Larder it is
in \`.env.local\`; in production it is an environment variable set in the host.

## 3. Restart and verify

Restart the agent so it loads the MCP server, then call:

\`\`\`text
list_pantry
\`\`\`

Expected: a JSON array of ingredients in stock with amounts and statuses. If you
get 401, the token is wrong. If you get 503, the server has no token configured.

## Available tools

- \`list_pantry({ query?, include_empty? })\`
- \`expiring_soon({ within_days? })\`
- \`list_leftovers()\`
- \`get_week_plan({ week_start? })\`
- \`search_recipes({ query?, limit? })\`
- \`get_recipe({ recipe_id })\`
- \`propose_shopping_list({ week_start? })\`
- \`list_ingredients({ query?, limit? })\`
- \`create_ingredient({ name, stock_unit, category?, grams_per_unit? })\`
- \`create_recipe({ title, servings, source_url?, steps?, ingredients[] })\`
- \`create_meal_plan({ week_start, note?, entries[] })\` — saves a **draft**

Sourcing from the web: if the library has nothing suitable, find a recipe,
present it with its source link, and only save it once the human agrees. Resolve
each line with \`list_ingredients\`, create genuinely new items, then call
\`create_recipe\`. It refuses lines it cannot convert rather than guessing.

\`create_meal_plan\` stores a draft that the human must activate in the Plan tab;
until then it affects neither shopping nor cooking. An entry with
\`kind: "leftover"\` is a planned leftover: it deducts nothing.

Cooking, ticking shopping items, and stock adjustments remain human actions.

## Notes

- The endpoint is stateless: no sessions, JSON responses, safe behind a
  serverless function.
- Pass the token as \`Authorization: Bearer <token>\` on every request.
- Revoke by rotating \`LARDER_MCP_TOKEN\` on the server and restarting.
`;

  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
