import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
if (existsSync(".env")) loadEnvFile(".env");

const provider = (process.env.PI_PROVIDER || "openai").trim().toLowerCase();
const baseUrl = (process.env.PI_BASE_URL || "").trim();
const customKey = (process.env.PI_API_KEY || "").trim();
const defaultModels = { "minimax-cn": "MiniMax-M2.7" };

export const config = {
  port: Number(process.env.PORT || 3000),
  provider,
  model: process.env.PI_MODEL || defaultModels[provider] || "gpt-4.1-mini",
  // Custom OpenAI-compatible endpoints use an independent credential.
  // Never return this key in /api/status or any client event.
  baseUrl,
  dataDir: process.env.DATA_DIR || "./data",
  contextWindow: Number(process.env.PI_CONTEXT_WINDOW || 128000),
  maxTokens: Number(process.env.PI_MAX_TOKENS || 8192),
  live: provider === "custom"
    ? Boolean(customKey && baseUrl)
    : provider === "anthropic"
      ? Boolean(process.env.ANTHROPIC_API_KEY)
      : provider === "minimax-cn"
        ? Boolean(process.env.MINIMAX_CN_API_KEY)
        : provider === "openai"
          ? Boolean(process.env.OPENAI_API_KEY)
          : false
};
