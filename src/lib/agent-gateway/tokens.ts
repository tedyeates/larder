import { createHash, randomBytes } from "node:crypto";

const AGENT_TOKEN_PREFIX = "agt_";
const AGENT_TOKEN_RANDOM_BYTES = 32;
const AGENT_TOKEN_PATTERN = /^agt_[A-Za-z0-9_-]{43}$/;

/** A secret presented only once to the Agent Runner's operator. */
export function mintAgentTokenSecret(): string {
  return `${AGENT_TOKEN_PREFIX}${randomBytes(AGENT_TOKEN_RANDOM_BYTES).toString("base64url")}`;
}

/** SHA-256 is one-way here: the database never receives the token secret. */
export function hashAgentToken(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Reject obviously malformed credentials before any database lookup. */
export function isAgentTokenSecret(value: string): boolean {
  return AGENT_TOKEN_PATTERN.test(value);
}
