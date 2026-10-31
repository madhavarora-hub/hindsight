#!/usr/bin/env node
// hindsight <command>
//   state                 track record rebuilt from memory
//   snapshot              live Sui readings (and Tatum reference price if keyed)
//   bots [minutes]        every house bot logs one call (default window 3 min)
//   resolve               settle every call whose deadline has passed
//   loop [rounds] [min]   bots -> wait -> resolve, repeated (the learning loop)
//   coach <voice> <kind> <p>   what the track record says about a draft call
//   export                write web/ledger.json (public, read-only copy of the record)
//   restore               ask the relayer to re-index this namespace from Walrus
//   preflight [--write-test]  check .env, Tatum and Walrus auth before `loop` (read-only by default)

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, loadEnv, makeEngine } from "./setup.js";
import { runBots } from "../core/bots.js";
import { pct } from "../core/scoring.js";

loadEnv();
const [cmd = "state", ...args] = process.argv.slice(2);
if (cmd === "preflight") {
  const { main } = await import("./preflight.js");
  process.exit(await main(args));
}
const engine = await makeEngine();
const say = (...a) => console.log(...a);
say(`memory: ${engine.store.name} | chain: ${engine.sui.name} | ${engine.log.length} memories loaded`);

const commands = {
  async state() {
    const s = engine.state();
    say(`\n${s.open.length} open, ${s.resolutions.length} resolved, ${s.writes} memories`);
    for (const v of s.voices) say(`  ${v.voice.padEnd(20)} ${v.hits}/${v.n} right  stated ~${pct(v.meanConf)}  skill ${v.skill.toFixed(2)}  ${v.verdict}`);
    for (const l of s.lessons) say(`  ${l.active ? "*" : " "} ${l.text}`);
  },
  async snapshot() {
    say(JSON.stringify(await engine.snapshot(), null, 2));
  },
  async bots(min = "3") {
    for (const r of await runBots(engine, { windowMin: Number(min) })) say(`  logged ${r.f.voice}: ${r.text} @ ${pct(r.f.p)}  blob ${r.blobId}`);
  },
  async resolve() {
    const { resolved, lessons } = await engine.resolveDue();
    for (const r of resolved) say(`  ${r.outcome ? "YES" : "NO "} ${r.voice}: ${r.text} (observed ${+r.observed.toFixed(6)})  blob ${r.blobId}`);
    for (const l of lessons) say(`  NEW LESSON ${l.text}  blob ${l.blobId}`);
    if (!resolved.length) say("  nothing due");
  },
  async loop(rounds = "3", min = "3") {
    for (let i = 1; i <= Number(rounds); i++) {
      say(`\nround ${i}/${rounds}`);
      await commands.bots(min);
      await new Promise((r) => setTimeout(r, Number(min) * 60_000 + 15_000));
      await commands.resolve();
    }
    await commands.state();
  },
  async coach(voice, kind = "sui_price", p = "0.9") {
    say(JSON.stringify(await engine.coach({ voice, kind, p: Number(p) }), null, 2));
  },
  async export() {
    const s = engine.state();
    const ledger = { exportedAt: new Date().toISOString(), store: s.store, mainnet: s.mainnet, source: s.source, memories: s.memories };
    writeFileSync(resolve(ROOT, "web/ledger.json"), JSON.stringify(ledger, null, 1));
    say(`wrote web/ledger.json with ${s.memories.length} memories`);
  },
  async restore() {
    if (!engine.store.restore) return say("this store has nothing to restore");
    say(JSON.stringify(await engine.store.restore(), null, 2));
  },
};

if (!commands[cmd]) {
  say(`unknown command ${cmd}; try: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}
await commands[cmd](...args);
