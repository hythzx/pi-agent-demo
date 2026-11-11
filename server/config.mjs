import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
if (existsSync(".env")) loadEnvFile(".env");
const provider = process.env.PI_PROVIDER || "openai";
const defaultModels = { "minimax-cn": "MiniMax-M2.7" };
export const config = {
  port: Number(process.env.PORT || 3000),
  provider,
  model: process.env.PI_MODEL || defaultModels[provider] || "gpt-4.1-mini",
  dataDir: process.env.DATA_DIR || "./data",
  live: provider === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : provider === "minimax-cn"
      ? Boolean(process.env.MINIMAX_CN_API_KEY)
      : Boolean(process.env.OPENAI_API_KEY),
};
