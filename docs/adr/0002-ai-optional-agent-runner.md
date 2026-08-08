# AI planning is an optional capability behind an Agent Runner API

One codebase, two deployments. Run locally on the desktop and the app sits next to an Agent
Runner container, streaming the planning conversation into the UI; deployed to Vercel, the
planning routes are absent and the AI features are hidden. Both instances share the same Supabase
database, so everything deterministic — Shopping List, Pantry, Cook, Meal Log, recipes — behaves
identically wherever you open it.

The Agent Runner is addressed by a configurable URL and speaks a small contract: accept a message,
stream a reply, and submit Plan Proposals back through the app's MCP. Any container honouring it
can be dropped in, and nothing about the app assumes kiro-cli. The container's environment holds its
own model-provider credentials plus an Agent Token for calling the app, and never database
credentials.

The consequence accepted here: planning requires the desktop until a streaming transport is built
for the hosted deployment. Every deterministic feature — including authoring recipes, defining
substitutes and resolving ingredients — is fully usable on mobile. The split is AI versus
deterministic, not phone versus desktop.
