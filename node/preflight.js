#!/usr/bin/env node
// hindsight preflight [--write-test]
//
// Run before `loop`: checks .env, makes ONE read-only Tatum Sui RPC call and
// ONE read-only Walrus Memory auth call. Nothing is written and no gas is spent
// unless --write-test is passed, which stores a single memory in the separate
// "hindsight-preflight" namespace (the app's ledger namespace is untouched).
// Secrets are never printed: at most the last 4 characters of non-private values.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkEnv, formatChecklist, scrub } from "../core/preflight.js";
import { TatumSui } from "../core/sui.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 20_000;
const WRITE_TEST_NAMESPACE = "hindsight-preflight";

const timed = (...a) => globalThis.fetch(a[0], { ...a[1], signal: AbortSignal.timeout(TIMEOUT_MS) });

export async function main(args = [], env = process.env) {
  const writeTest = args.includes("--write-test");
  const envFile = resolve(ROOT, ".env");
  const envFileExists = existsSync(envFile);
  // Same precedence as the app: shell variables win over .env.
  if (envFileExists && env === process.env) process.loadEnvFile(envFile);

  const secrets = [env.MEMWAL_KEY, env.MEMWAL_ACCOUNT_ID, env.TATUM_API_KEY];
  const clean = (e) => scrub(e?.cause?.message ? `${e.message} (${e.cause.message})` : e?.message ?? e, secrets);
  const results = checkEnv(env, { envFileExists });
  const ok = (name) => results.find((r) => r.name === name)?.status === "PASS";

  const [major, minor] = process.versions.node.split(".").map(Number);
  results.push(major > 22 || (major === 22 && minor >= 23)
    ? { name: "node version", status: "PASS", detail: process.versions.node }
    : { name: "node version", status: "FAIL", detail: process.versions.node, fix: "install Node 22.23.4 or newer" });

  // Tatum: one read-only call.
  if (ok("TATUM_API_KEY")) {
    try {
      const seq = await new TatumSui({ apiKey: env.TATUM_API_KEY, fetchImpl: timed }).rpc("sui_getLatestCheckpointSequenceNumber");
      results.push({ name: "Tatum Sui RPC", status: "PASS", detail: `mainnet checkpoint ${seq}` });
    } catch (e) {
      const msg = clean(e);
      const fix = /HTTP 40[13]/.test(msg) ? "the key was rejected: create a new one at dashboard.tatum.io and paste it again"
        : /HTTP 429/.test(msg) ? "rate limited: wait a minute and re-run"
        : "check your network, then re-run; https://status.tatum.io if it persists";
      results.push({ name: "Tatum Sui RPC", status: "FAIL", detail: msg, fix });
    }
  } else results.push({ name: "Tatum Sui RPC", status: "FAIL", detail: "skipped (TATUM_API_KEY invalid)", fix: "fix TATUM_API_KEY first" });

  // Walrus Memory: public health, then a signed metadata-only list (proves the key and account match).
  if (ok("MEMWAL_KEY") && ok("MEMWAL_ACCOUNT_ID")) {
    let WalrusStore;
    try {
      ({ WalrusStore } = await import("./walrus-store.js"));
    } catch (e) {
      results.push({ name: "Walrus Memory SDK", status: "FAIL", detail: clean(e), fix: "run `npm install`" });
    }
    if (WalrusStore) {
      const opts = { key: env.MEMWAL_KEY, accountId: env.MEMWAL_ACCOUNT_ID, serverUrl: env.MEMWAL_SERVER_URL || undefined, namespace: env.HINDSIGHT_NAMESPACE || undefined };
      let store;
      try {
        store = new WalrusStore(opts);
        await store.health();
        results.push({ name: "Walrus relayer", status: "PASS", detail: `${store.name} reachable` });
      } catch (e) {
        results.push({ name: "Walrus relayer", status: "FAIL", detail: clean(e), fix: "check your network or MEMWAL_SERVER_URL, then re-run" });
      }
      if (store) {
        try {
          const page = await store.client.listNamespaces();
          const mine = page.namespaces?.find((n) => n.name === store.namespace);
          results.push({ name: "Walrus Memory auth", status: "PASS",
            detail: `key accepted; namespace ${store.namespace} has ${mine?.memory_count ?? 0} memories` });
        } catch (e) {
          results.push({ name: "Walrus Memory auth", status: "FAIL", detail: clean(e),
            fix: "MEMWAL_KEY must be a delegate key registered on MEMWAL_ACCOUNT_ID (memory.walrus.xyz > Delegate keys); check you copied the private key, not the public one" });
        }
        if (writeTest && results.at(-1).status === "PASS") {
          try {
            const probe = new WalrusStore({ ...opts, namespace: WRITE_TEST_NAMESPACE });
            const r = await probe.remember(`hindsight preflight write test ${new Date().toISOString()}`);
            results.push({ name: "Walrus write test", status: "PASS", detail: `blob ${r.blobId} in namespace ${WRITE_TEST_NAMESPACE}` });
          } catch (e) {
            results.push({ name: "Walrus write test", status: "FAIL", detail: clean(e), fix: "the account may need SUI/credits for writes; check memory.walrus.xyz" });
          }
        }
      }
    }
  } else results.push({ name: "Walrus Memory auth", status: "FAIL", detail: "skipped (MEMWAL_KEY or MEMWAL_ACCOUNT_ID invalid)", fix: "fix the MEMWAL_* values first" });

  if (!writeTest) results.push({ name: "writes", status: "PASS", detail: "none made (pass --write-test to store one test memory)" });
  const { text, ok: passed } = formatChecklist(results);
  console.log(`hindsight preflight\n${text}`);
  return passed ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
