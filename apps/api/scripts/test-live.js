#!/usr/bin/env node
import { spawn } from "child_process";

process.env.REQUIRE_LIVE_TESTS = "true";

const vitest = spawn("npx", ["vitest", "run", "tests/stage3-crud.test.js"], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    REQUIRE_LIVE_TESTS: "true",
  },
});

vitest.on("exit", (code) => {
  process.exit(code ?? 0);
});

