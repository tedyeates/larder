import { AppNav } from "@/components/app-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { isAgentRunnerConfigured } from "@/lib/planner/config";

export const dynamic = "force-dynamic";

/**
 * Shell shared by every authenticated page: header with sign-out, nav that
 * is a sidebar on desktop and a bottom bar on mobile, and a scrollable
 * content area. Middleware guarantees nothing under this layout renders for
 * a signed-out visitor.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AppNav plannerAvailable={isAgentRunnerConfigured()} />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-foreground/10 px-4 py-3">
          <span className="text-lg font-semibold">Larder</span>
          <SignOutButton />
        </header>
        <main className="flex-1 px-4 py-6 pb-24 md:pb-6">{children}</main>
      </div>
    </div>
  );
}
