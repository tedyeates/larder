import { auth } from "@/lib/auth/server";

/** Every auth route the managed server exposes, proxied same-origin. */
export const { GET, POST, PUT, DELETE, PATCH } = auth.handler();
