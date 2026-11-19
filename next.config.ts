import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Dynamic routes are not kept in the client router cache by default, so
     * every tab switch refetches. Hold each payload for 30s: switching back is
     * instant, and every server action revalidates the paths it changes.
     */
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default nextConfig;
