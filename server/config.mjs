import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
if (existsSync(".env")) loadEnvFile(".env");
export const config = {
  port: Number(process.env.PORT || 3000),
  provider: process.env.PI_PROVIDER || "openai",
  model: process.env.PI_MODEL || "gpt-4.1-mini",
  dataDir: process.env.DATA_DIR || "./data",
  live: process.env.PI_PROVIDER === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY),
};
