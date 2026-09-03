import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: [
        "lib/policyGate.js",
        "lib/aiScoring.js",
        "lib/geminiScoring.js",
        "lib/fallbackHeuristic.js",
        "lib/refundExecutor.js",
        "lib/ingestTransaction.js",
      ],
    },
  },
});
