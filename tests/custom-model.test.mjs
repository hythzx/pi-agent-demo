import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// No API calls: this validates registration of a model that is NOT in Pi's catalog.
test("custom OpenAI-compatible model can be created from Base URL and API Key", () => {
  const code = `
    import { createDataAgent } from "./server/agent.mjs";
    import { config } from "./server/config.mjs";
    const agent = createDataAgent("test-custom-session");
    const model = agent.state.model;
    console.log(JSON.stringify({ live: config.live, provider: model.provider,
      model: model.id, api: model.api, baseUrl: model.baseUrl }));
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      PI_PROVIDER: "custom",
      PI_BASE_URL: "https://api.deepseek.com",
      PI_API_KEY: "fake-key-for-local-registration-test",
      PI_MODEL: "deepseek-chat",
      PI_CONTEXT_WINDOW: "128000",
      PI_MAX_TOKENS: "8192"
    }
  });
  const result = JSON.parse(output.trim().split("\n").at(-1));
  assert.deepEqual(result, {
    live: true,
    provider: "custom",
    model: "deepseek-chat",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com"
  });
});
