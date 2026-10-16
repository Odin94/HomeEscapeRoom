import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/lib/schema.server.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: process.env.DATABASE_PATH || "data/threshold.sqlite" },
});
