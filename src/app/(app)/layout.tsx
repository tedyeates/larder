import { AppNav } from "@/components/app-nav";

/**
 * The tabbed shell: a persistent bottom nav so switching tabs only swaps the
 * page content (and its loading fallback), never the navigation itself.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AppNav />
    </>
  );
}
