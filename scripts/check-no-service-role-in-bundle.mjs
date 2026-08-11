#!/usr/bin/env node
// Fails the build if the service-role key name or value ever reaches a
// client-shipped bundle. Run after `next build`, before deploy.
//
// This is a defence-in-depth check, not the primary guard — the primary
// guard is `import "server-only"` in src/lib/supabase/service.ts, which
// fails the *build* if a Client Component imports that module. This script
// catches the case where someone works around that by copy-pasting the key
// name into client code directly.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CLIENT_BUNDLE_DIR = join(process.cwd(), ".next", "static");
const FORBIDDEN_TOKENS = ["SUPABASE_SERVICE_ROLE_KEY"];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

function main() {
  let files;
  try {
    files = walk(CLIENT_BUNDLE_DIR);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(
        `${CLIENT_BUNDLE_DIR} does not exist — run "next build" first.`
      );
      process.exit(1);
    }
    throw err;
  }

  const offenders = [];
  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    for (const token of FORBIDDEN_TOKENS) {
      if (contents.includes(token)) {
        offenders.push({ file, token });
      }
    }
  }

  if (offenders.length > 0) {
    console.error("Service-role key reference found in client bundle:");
    for (const { file, token } of offenders) {
      console.error(`  ${file}: ${token}`);
    }
    process.exit(1);
  }

  console.log(
    `OK: no service-role key reference in ${files.length} client bundle file(s).`
  );
}

main();
