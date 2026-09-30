import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@company-db": resolve(__dirname, "./src"),
    },
  },
});
