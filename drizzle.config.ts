import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next loads .env.local for the app; drizzle-kit needs telling.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  strict: true,
  verbose: true,
  dbCredentials: {
    // Migrations want the direct endpoint; transaction-mode pooling can break DDL.
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/larder",
  },
});
