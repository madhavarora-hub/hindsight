import { test } from "node:test";
import assert from "node:assert/strict";
import { Hindsight } from "../core/engine.js";
import { LocalStore } from "../core/local-store.js";
import { encode, decode } from "../core/codec.js";
import { suggest, lessons, voiceStats, brier } from "../core/scoring.js";
import { cetusSqrtPriceToUsdPerSui, TatumSui } from "../core/sui.js";
import { settle } from "../core/markets.js";

// A scripted chain: tests move the clock and the price by hand.
function fakeSui(state) {
  return {
    name: "fake-sui",
    async checkpoint() {
      return { seq: state.seq, digest: "d" + state.seq, timestampMs: state.now, networkTotalTransactions: state.tx, epoch: 1 };
    },
    async checkpointAt(seq) {
      return { seq, digest: "d" + seq, timestampMs: state.now - 1000, networkTotalTransactions: state.tx - 100, epoch: 1 };
    },
    async suiPrice() {
      return { usd: state.price, objectVersion: 1, objectDigest: "x" };
    },
    async referenceGasPrice() {
      return 100;
    },
    async balanceSui() {
      return 5;
    },
  };
}

function setup() {
  const chain = { now: 1_000_000, seq: 1, tx: 10_000, price: 1 };
  const store = new LocalStore();
  const engine = new Hindsight({ store, sui: fakeSui(chain), now: () => chain.now });
  return { chain, store, engine };
}

const call = (over = {}) => ({ voice: "hal", kind: "sui_price", op: ">", threshold: 1.01, p: 0.9, deadlineMs: 0, ...over });

test("codec round-trips and keeps a readable sentence", () => {
  const rec = { t: "forecast", f: { id: "a", voice: "v", kind: "gas_price", op: "<", threshold: 101, p: 0.8, deadlineMs: 0 } };
  const text = encode(rec);
  assert.match(text, /^Hindsight forecast by v: Sui reference gas price will be below 101 MIST/);
  assert.deepEqual(decode(text), rec);
  assert.equal(decode("not ours"), null);
});

test("Cetus sqrt price converts to USD per SUI", () => {
  // sqrt_price observed on mainnet when CoinGecko showed SUI at $0.912
  const usd = cetusSqrtPriceToUsdPerSui("611324747069645843893");
  assert.ok(Math.abs(usd - 0.9105) < 0.001, usd);
});

test("settle is strict on both sides", () => {
  assert.equal(settle(">", 2, 1), true);
  assert.equal(settle(">", 1, 1), false);
  assert.equal(settle("<", 1, 1), false);
});

test("an overconfident voice gets a lesson, and the coach shades its next call", async () => {
  const { chain, engine } = setup();
  for (let i = 0; i < 4; i++) {
    await engine.forecast(call({ deadlineMs: chain.now + 60_000 }));
    chain.now += 61_000;
    chain.seq += 1;
    const { resolved, lessons: written } = await engine.resolveDue();
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].outcome, false); // price never moved
    if (i === 2) assert.match(written[0].text, /hal is overconfident/);
  }
  const advice = await engine.coach({ voice: "hal", kind: "sui_price", p: 0.9 });
  assert.ok(advice.p < 0.6, `coach should shade 90% down, got ${advice.p}`);
  assert.ok(advice.lessons.some((l) => /overconfident/.test(l)));
  assert.ok(advice.recalled.length > 0);

  const accepted = await engine.forecast(call({ deadlineMs: chain.now + 60_000 }), { acceptSuggestion: true });
  assert.equal(accepted.f.statedP, 0.9);
  assert.ok(accepted.f.p < 0.6);
});

test("state is rebuilt from memory alone", async () => {
  const { chain, store, engine } = setup();
  await engine.forecast(call({ deadlineMs: chain.now + 1 }));
  await engine.forecast(call({ voice: "sam", p: 0.3, deadlineMs: chain.now + 1 }));
  chain.now += 10;
  await engine.resolveDue();
  const before = engine.state();

  const fresh = new Hindsight({ store: new LocalStore({ initial: store.items }), sui: fakeSui(chain), now: () => chain.now });
  await fresh.load();
  const after = fresh.state();
  assert.equal(after.resolutions.length, 2);
  assert.deepEqual(after.voices, before.voices);
  assert.equal(after.writes, before.writes);
});

test("resolution waits for the chain to pass the deadline", async () => {
  const { chain, engine } = setup();
  await engine.forecast(call({ deadlineMs: chain.now + 5 }));
  const realNow = chain.now;
  engine.now = () => realNow + 10; // wall clock past the deadline, chain is not
  const { resolved } = await engine.resolveDue();
  assert.equal(resolved.length, 0);
});

test("invalid calls are rejected before anything is written", async () => {
  const { chain, engine, store } = setup();
  await assert.rejects(engine.forecast(call({ p: 1, deadlineMs: chain.now + 5 })), /p must be/);
  await assert.rejects(engine.forecast(call({ deadlineMs: chain.now - 5 })), /deadline/);
  assert.equal(store.items.length, 0);
});

test("scoring basics", () => {
  assert.equal(brier(0.9, false), 0.81);
  const rs = [0, 1, 2].map(() => ({ voice: "v", kind: "k", p: 0.9, outcome: false }));
  assert.equal(voiceStats(rs)[0].verdict, "overconfident");
  assert.equal(lessons(rs).length, 2); // overall + per kind
  assert.equal(suggest({ voice: "new", kind: "k", p: 0.7 }, rs).delta, 0);
});

test("Tatum RPC client sends the key and unwraps results", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "750" }) };
  };
  const t = new TatumSui({ apiKey: "k", fetchImpl });
  assert.equal(await t.referenceGasPrice(), 750);
  assert.equal(seen[0].url, "https://sui-mainnet.gateway.tatum.io");
  assert.equal(seen[0].headers["x-api-key"], "k");
  assert.equal(seen[0].body.method, "suix_getReferenceGasPrice");
});
