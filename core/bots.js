// House forecasters. Each one is a fixed, published rule applied to live Sui
// data, so the app has real calls to score from minute one. They are labelled
// as bots everywhere; they are not users.

export const BOTS = [
  {
    voice: "hype-hal (bot)",
    style: "Always calls a pump: 90% that SUI is up 0.3% in the window.",
    draft: (s, w) => ({ kind: "sui_price", op: ">", threshold: r6(s.suiUsd * 1.003), p: 0.9, deadlineMs: w }),
  },
  {
    voice: "steady-sam (bot)",
    style: "Coin-flip honest: 52% that SUI ends the window higher than now.",
    draft: (s, w) => ({ kind: "sui_price", op: ">", threshold: s.suiUsd, p: 0.52, deadlineMs: w }),
  },
  {
    voice: "tx-tina (bot)",
    style: "Extrapolates the last 1,000 checkpoints: 65% that network throughput holds.",
    draft: (s, w, now) => ({
      kind: "network_tx",
      op: ">",
      threshold: Math.round(s.txPerSec * ((w - now) / 1000)),
      p: 0.65,
      deadlineMs: w,
    }),
  },
  {
    voice: "gas-gary (bot)",
    style: "Bets on stability: 95% that the reference gas price stays where it is.",
    draft: (s, w) => ({ kind: "gas_price", op: "<", threshold: s.gasPrice + 1, p: 0.95, deadlineMs: w }),
  },
];

/** Every bot logs one call on the current snapshot, resolving after windowMin minutes. */
export async function runBots(engine, { windowMin = 3, only } = {}) {
  const snap = await engine.snapshot();
  const now = engine.now();
  const deadline = now + windowMin * 60_000;
  const out = [];
  for (const b of BOTS) {
    if (only && !only.includes(b.voice)) continue;
    const d = { voice: b.voice, note: b.style, ...b.draft(snap, deadline, now) };
    out.push(await engine.forecast(d));
  }
  return out;
}

const r6 = (x) => Math.round(x * 1e6) / 1e6;
