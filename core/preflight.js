// Offline half of `npm run preflight`: validates the mainnet settings and masks
// every secret before anything is printed. No I/O here, so it is unit-tested
// directly; node/preflight.js adds the read-only network checks.

export const MAINNET_RELAYER = "https://relayer.memory.walrus.xyz";

const HEX64 = /^(0x)?[0-9a-fA-F]{64}$/;
const SUI_OBJECT_ID = /^0x[0-9a-fA-F]{64}$/;
// suiprivkey1 + bech32 of (flag byte + 32-byte seed) + 6-char checksum.
const SUI_PRIVKEY = /^suiprivkey1[02-9ac-hj-np-z]{59}$/;
const TATUM_KEY = /^[A-Za-z0-9_-]{20,}$/;
const NAMESPACE = /^[A-Za-z0-9._-]{1,64}$/;
const PLACEHOLDER = /^(<.*>|\.\.\.|x+|changeme|todo|your[_-]?.*|paste[_-]?.*)$/i;

/** At most the last 4 characters survive; short values show nothing at all. */
export function mask(value) {
  if (value == null || value === "") return "(empty)";
  const s = String(value);
  return s.length < 12 ? `*** (${s.length} chars)` : `****${s.slice(-4)} (${s.length} chars)`;
}

/** For private keys: length only, not even a suffix. */
export function maskAll(value) {
  if (value == null || value === "") return "(empty)";
  return `*** (${String(value).length} chars)`;
}

/** Replace any secret that leaks into an error message with its mask. */
export function scrub(text, secrets = []) {
  let out = String(text);
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join(mask(s));
  return out;
}

// Problems every value can have, whatever its expected format.
function common(name, value) {
  if (value == null || value === "") return { fix: `set ${name} in .env (see .env.example)`, detail: "missing" };
  if (value !== value.trim()) return { fix: `remove the spaces or line break around ${name}`, detail: "has surrounding whitespace" };
  if (/^["'`]|["'`]$/.test(value)) return { fix: `remove the stray quote around ${name}`, detail: "has a stray quote" };
  if (PLACEHOLDER.test(value)) return { fix: `replace the placeholder in ${name} with the real value`, detail: "looks like a placeholder" };
  return null;
}

const pass = (name, detail) => ({ name, status: "PASS", detail });
const fail = (name, detail, fix) => ({ name, status: "FAIL", detail, fix });
const warn = (name, detail, fix) => ({ name, status: "WARN", detail, fix });

export function checkMemwalKey(value) {
  const name = "MEMWAL_KEY";
  const c = common(name, value);
  if (c) return fail(name, c.detail, c.fix);
  if (HEX64.test(value)) return pass(name, `64-char hex private key ${maskAll(value)}`);
  if (SUI_PRIVKEY.test(value)) return pass(name, `suiprivkey bech32 key ${maskAll(value)}`);
  if (/^(0x)?[0-9a-fA-F]+$/.test(value))
    return fail(name, `hex but ${value.replace(/^0x/, "").length} chars, expected 64 ${maskAll(value)}`,
      "copy the delegate PRIVATE key (32 bytes = 64 hex chars) from memory.walrus.xyz > Delegate keys");
  return fail(name, `not 64-char hex or suiprivkey1... ${maskAll(value)}`,
    "copy the delegate PRIVATE key from memory.walrus.xyz > Delegate keys (hex, or suiprivkey1...)");
}

export function checkAccountId(value) {
  const name = "MEMWAL_ACCOUNT_ID";
  const c = common(name, value);
  if (c) return fail(name, c.detail, c.fix);
  if (SUI_OBJECT_ID.test(value)) return pass(name, `0x + 64 hex ${mask(value)}`);
  if (/^[0-9a-fA-F]{64}$/.test(value)) return fail(name, `missing 0x prefix ${mask(value)}`, "prefix MEMWAL_ACCOUNT_ID with 0x");
  return fail(name, `expected 0x + 64 hex chars ${mask(value)}`,
    "copy the Account ID (0x...) shown on memory.walrus.xyz, not your wallet address or key");
}

export function checkTatumKey(value) {
  const name = "TATUM_API_KEY";
  const c = common(name, value);
  if (c) return fail(name, c.detail, c.fix);
  if (TATUM_KEY.test(value)) return pass(name, `format ok ${mask(value)}`);
  return fail(name, `expected 20+ letters, digits, - or _ ${mask(value)}`, "copy the API key from dashboard.tatum.io > API keys");
}

/** Run every offline check against an env object. Returns a list of {name, status, detail, fix}. */
export function checkEnv(env, { envFileExists = true } = {}) {
  const out = [];
  out.push(envFileExists
    ? pass(".env file", "found")
    : fail(".env file", "not found", "copy .env.example to .env in the repo root and fill it in"));

  const key = checkMemwalKey(env.MEMWAL_KEY);
  out.push(key, checkAccountId(env.MEMWAL_ACCOUNT_ID), checkTatumKey(env.TATUM_API_KEY));

  const strip = (v) => String(v ?? "").toLowerCase().replace(/^0x/, "");
  if (key.status === "PASS" && strip(env.MEMWAL_KEY) === strip(env.MEMWAL_ACCOUNT_ID))
    out.push(fail("MEMWAL_KEY vs ACCOUNT_ID", "the two values are identical", "MEMWAL_KEY is the delegate private key; MEMWAL_ACCOUNT_ID is the account object ID"));

  const url = env.MEMWAL_SERVER_URL;
  if (url) {
    let parsed = null;
    try { parsed = new URL(url); } catch {}
    if (!parsed || parsed.protocol !== "https:") out.push(fail("MEMWAL_SERVER_URL", "not an https URL", "remove MEMWAL_SERVER_URL to use the mainnet relayer"));
    else if (url.replace(/\/$/, "") !== MAINNET_RELAYER)
      out.push(warn("MEMWAL_SERVER_URL", `${parsed.host} is not the mainnet relayer`, "the hackathon needs mainnet writes; remove MEMWAL_SERVER_URL"));
  }
  const ns = env.HINDSIGHT_NAMESPACE;
  if (ns && !NAMESPACE.test(ns)) out.push(fail("HINDSIGHT_NAMESPACE", "invalid characters or too long", "use letters, digits, . _ - (max 64), or remove it"));
  return out;
}

/** "PASS  name  detail" lines plus a fix hint under each failure. */
export function formatChecklist(results) {
  const lines = [];
  for (const r of results) {
    lines.push(`  [${r.status}] ${r.name}: ${r.detail}`);
    if (r.status !== "PASS" && r.fix) lines.push(`         fix: ${r.fix}`);
  }
  const failed = results.filter((r) => r.status === "FAIL").length;
  lines.push("", failed ? `PREFLIGHT FAILED: ${failed} check(s) need fixing before \`loop\`.` : "PREFLIGHT PASSED: ready for `npm run cli -- loop 4 5`.");
  return { text: lines.join("\n"), ok: failed === 0 };
}
