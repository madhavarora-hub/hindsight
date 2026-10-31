// Wires the engine from environment variables. With MEMWAL_* set, memory is
// Walrus Memory on mainnet; with TATUM_API_KEY set, chain reads go through the
// Tatum Sui RPC gateway. Without them everything still runs, locally and
// against the public Sui GraphQL endpoint, and says so in every response.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hindsight } from "../core/engine.js";
import { LocalStore } from "../core/local-store.js";
import { makeSui, tatumUsdRate } from "../core/sui.js";
import { WalrusStore } from "./walrus-store.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnv() {
  const file = resolve(ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

export async function makeEngine(env = process.env) {
  const sui = makeSui({ tatumApiKey: env.TATUM_API_KEY });
  const rate = env.TATUM_API_KEY ? () => tatumUsdRate({ apiKey: env.TATUM_API_KEY }) : null;
  let store;
  if (env.MEMWAL_KEY && env.MEMWAL_ACCOUNT_ID) {
    store = new WalrusStore({
      key: env.MEMWAL_KEY,
      accountId: env.MEMWAL_ACCOUNT_ID,
      serverUrl: env.MEMWAL_SERVER_URL || undefined,
      namespace: env.HINDSIGHT_NAMESPACE || undefined,
    });
  } else {
    const file = resolve(ROOT, env.HINDSIGHT_LOCAL_FILE || "data/local-memories.json");
    const initial = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
    store = new LocalStore({
      initial,
      onChange: (items) => {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(items, null, 1));
      },
    });
  }
  return new Hindsight({ store, sui, rate }).load();
}
