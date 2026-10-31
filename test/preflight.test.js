import { test } from "node:test";
import assert from "node:assert/strict";
import { mask, maskAll, scrub, checkEnv, checkMemwalKey, checkAccountId, checkTatumKey, formatChecklist } from "../core/preflight.js";

const KEY = "ab".repeat(32);
const ACCOUNT = "0x" + "c3".repeat(32);
const TATUM = "t-66a1b2c3d4e5f6a7b8c9d0e1-0123456789abcdef0123456789abcdef";
const GOOD = { MEMWAL_KEY: KEY, MEMWAL_ACCOUNT_ID: ACCOUNT, TATUM_API_KEY: TATUM };

test("mask keeps at most the last 4 characters and hides short values entirely", () => {
  assert.equal(mask(TATUM), `****cdef (${TATUM.length} chars)`);
  assert.equal(mask("short"), "*** (5 chars)");
  assert.equal(mask(""), "(empty)");
  assert.equal(mask(undefined), "(empty)");
  assert.equal(maskAll(KEY), "*** (64 chars)");
  assert.ok(!mask(TATUM).includes(TATUM.slice(0, -4)));
});

test("scrub removes secrets from error text", () => {
  const msg = scrub(`Tatum rpc: HTTP 401 invalid key ${TATUM} for ${ACCOUNT}`, [TATUM, ACCOUNT, undefined]);
  assert.ok(!msg.includes(TATUM) && !msg.includes(ACCOUNT));
  assert.match(msg, /\*\*\*\*cdef/);
});

test("a well-formed .env passes every offline check without printing secrets", () => {
  const results = checkEnv(GOOD);
  assert.ok(results.every((r) => r.status === "PASS"), JSON.stringify(results));
  const { text, ok } = formatChecklist(results);
  assert.ok(ok);
  for (const secret of [KEY, ACCOUNT, TATUM, KEY.slice(-4)]) assert.ok(!text.includes(secret), `leaked ${secret}`);
});

test("missing .env and missing variables fail with a fix hint", () => {
  const results = checkEnv({}, { envFileExists: false });
  const failed = results.filter((r) => r.status === "FAIL").map((r) => r.name);
  assert.deepEqual(failed, [".env file", "MEMWAL_KEY", "MEMWAL_ACCOUNT_ID", "TATUM_API_KEY"]);
  assert.ok(results.filter((r) => r.status === "FAIL").every((r) => r.fix));
  const { text, ok } = formatChecklist(results);
  assert.equal(ok, false);
  assert.match(text, /PREFLIGHT FAILED: 4/);
  assert.match(text, /fix: copy \.env\.example to \.env/);
});

test("MEMWAL_KEY accepts 64 hex (with or without 0x) or suiprivkey, rejects other shapes", () => {
  assert.equal(checkMemwalKey(KEY).status, "PASS");
  assert.equal(checkMemwalKey("0x" + KEY).status, "PASS");
  assert.equal(checkMemwalKey("suiprivkey1" + "q".repeat(59)).status, "PASS");
  assert.equal(checkMemwalKey(KEY.slice(0, 62)).status, "FAIL");
  assert.equal(checkMemwalKey(KEY + KEY).status, "FAIL");
  assert.equal(checkMemwalKey("zz" + KEY.slice(2)).status, "FAIL");
  assert.equal(checkMemwalKey(` ${KEY}`).status, "FAIL");
  assert.equal(checkMemwalKey(`"${KEY}`).status, "FAIL");
  assert.equal(checkMemwalKey("<your key>").status, "FAIL");
  assert.ok(!JSON.stringify(checkMemwalKey(KEY.slice(0, 62))).includes(KEY.slice(-6, -2)));
});

test("MEMWAL_ACCOUNT_ID must be 0x + 64 hex", () => {
  assert.equal(checkAccountId(ACCOUNT).status, "PASS");
  const bare = checkAccountId(ACCOUNT.slice(2));
  assert.equal(bare.status, "FAIL");
  assert.match(bare.fix, /0x/);
  assert.equal(checkAccountId("0x1234").status, "FAIL");
});

test("TATUM_API_KEY format and placeholders", () => {
  assert.equal(checkTatumKey(TATUM).status, "PASS");
  assert.equal(checkTatumKey("abc").status, "FAIL");
  assert.equal(checkTatumKey("has space in the middle of it").status, "FAIL");
  assert.equal(checkTatumKey("your_tatum_api_key_here").status, "FAIL");
});

test("swapped or non-mainnet settings are caught", () => {
  const same = checkEnv({ ...GOOD, MEMWAL_ACCOUNT_ID: "0x" + KEY });
  assert.ok(same.some((r) => r.name === "MEMWAL_KEY vs ACCOUNT_ID" && r.status === "FAIL"));
  const testnet = checkEnv({ ...GOOD, MEMWAL_SERVER_URL: "https://relayer.staging.example" });
  assert.ok(testnet.some((r) => r.name === "MEMWAL_SERVER_URL" && r.status === "WARN"));
  assert.ok(formatChecklist(testnet).ok, "a warning alone does not fail preflight");
  assert.ok(checkEnv({ ...GOOD, MEMWAL_SERVER_URL: "http://relayer.memory.walrus.xyz" }).some((r) => r.status === "FAIL"));
  assert.ok(checkEnv({ ...GOOD, MEMWAL_SERVER_URL: "https://relayer.memory.walrus.xyz/" }).every((r) => r.status === "PASS"));
  assert.ok(checkEnv({ ...GOOD, HINDSIGHT_NAMESPACE: "bad name!" }).some((r) => r.status === "FAIL"));
});
