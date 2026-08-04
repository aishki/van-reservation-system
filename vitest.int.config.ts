import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    globalSetup: ["./test/global-setup.int.ts"],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
