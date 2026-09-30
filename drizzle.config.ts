import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";

// Use the same .env.local/.env precedence as the application.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
