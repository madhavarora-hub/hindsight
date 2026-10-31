# Hindsight

**A forecasting coach that remembers who was right.**

You log a call ("SUI trades above $0.95 by Friday, 70%"). When the deadline passes, Hindsight settles it from Sui mainnet itself, through the Tatum Sui RPC gateway, so nobody grades their own homework. Every call, every result and every lesson goes into **Walrus Memory**. The next time you, or an analyst you follow, make a call, Hindsight recalls that track record and tells you what the number really means. For example: *"hype-hal said 90% on 6 price calls and was right 0 times. Treat a 90% from hal as ~51%."*

Built for the **Tatum x Walrus "Total Recall" hackathon**, Markets & Sports Prediction track.

- Live demo (keyless, runs in your browser): https://madhavarora-hub.github.io/hindsight/
- Mainnet ledger: the demo's "Mainnet ledger" panel lists this project's own Walrus Memory writes with their blob IDs.

## Why

Prediction apps track picks. Almost none of them track **calibration**, the thing that tells you whether to trust someone's "80%". Calibration only matters over many calls and many weeks, so it needs memory that outlives a session, a device and the app itself. That is what Walrus Memory is for.

## What it does

| | |
|---|---|
| **Log a call** | Pick a market Sui can settle: SUI price on the Cetus USDC/SUI pool, the reference gas price, network transaction count in a window, or any address's SUI balance. Hindsight reads the baseline from chain at that moment. |
| **Live coaching** | While you type a name and drag the confidence slider, Hindsight recalls that voice's record from Walrus Memory and suggests a corrected number. "Log Hindsight's number" stores both: what you said and what you logged. |
| **Settlement from chain** | At the deadline, the outcome is measured from a Sui mainnet checkpoint. The checkpoint sequence number and digest, plus the source (`tatum-sui-rpc`), are stored as evidence with the result. |
| **Who to trust** | Each voice gets a hit rate, Brier skill score and a verdict (overconfident, underconfident, calibrated, worse than a coin flip). |
| **Lessons** | When a voice drifts 15+ points from what it claims over 3+ calls, Hindsight writes a plain-English lesson to memory. If the record later improves, the lesson is shown as stale. |
| **Source disagreement** | With a Tatum key, the live strip compares the on-chain Cetus price with Tatum's off-chain rate and flags gaps over 1%. |
| **House bots** | Four labelled bots apply fixed, published rules to live data (one always calls a pump, one flips a fair coin, and so on). They exist so the learning loop has real, chain-settled calls to learn from in minutes. They are bots, not users, and are named that way everywhere. |

## How memory is used

Walrus Memory is the **only** database. Each memory is one sentence for semantic recall, followed by a machine tag so the exact state can be rebuilt:

```
Hindsight resolution: hype-hal (bot) said 90% that SUI will trade above $0.9140 on Cetus at
2026-10-31 00:54 UTC. NO happened, so the call was wrong. Observed 0.91122 at Sui checkpoint
339960649. [hs1 {"t":"resolution","f":{...},"outcome":false,"observed":0.91122,"evidence":{...}}]
```

- **Write**: `rememberAndWait` for every forecast, resolution and lesson, with a content-hash idempotency key so a retried write can't create a duplicate.
- **Recall for state**: on startup, `load()` rebuilds open calls, the track record and lessons from recall alone. Start the app on another machine with the same account and everything is there.
- **Recall for coaching**: `coach()` runs a semantic query ("how reliable is X on price calls?") and shows the recalled memories next to the suggestion, so you can see why the number moved.
- **Restore**: `npm run cli restore` asks the relayer to re-index the namespace from its Walrus blobs.

Three record types: `forecast`, `resolution`, `lesson`. See [`core/codec.js`](core/codec.js).

## The learning loop

[`core/scoring.js`](core/scoring.js) is pure functions:

1. A resolved call is `{ voice, kind, p, outcome }`. A hit is `outcome === (p >= 0.5)`.
2. **Suggest**: find the voice's past calls at a similar confidence (±10 points), first on the same market and then on any market. Then shrink the observed hit rate toward the stated confidence with 4 pseudo-calls, so 2 unlucky calls don't swing the number. With no record, Hindsight keeps your number.
3. **Lessons**: a gap of 15+ points between average confidence and hit rate over 3+ calls becomes a lesson, written to memory when it is new or has moved by 10+ points.
4. **Skill**: Brier skill against always saying 50%. 1 is perfect, 0 is a coin, below 0 is worse than a coin.

## Tatum integration

- [`core/sui.js`](core/sui.js) `TatumSui`: JSON-RPC to `https://sui-mainnet.gateway.tatum.io` with `x-api-key`. It reads `sui_getLatestCheckpointSequenceNumber`, `sui_getCheckpoint`, `sui_getObject` (the Cetus pool's `current_sqrt_price`, converted from Q64.64), `suix_getReferenceGasPrice` and `suix_getBalance`.
- `tatumUsdRate`: Tatum Data API exchange rate, used as the off-chain reference for the disagreement flag.
- Without a key, the same interface falls back to public Sui GraphQL, and every result is labelled with the source that produced it.

## Run it

Requires Node 22.23.4+.

```bash
npm install
npm test                 # 9 tests: codec, Cetus price math, settlement, learning loop, rebuild-from-memory, Tatum client
npm start                # http://127.0.0.1:8787/web/
```

With no keys, memory is a local file (`data/`) and chain reads use public Sui GraphQL. The UI badges say so.

### Mainnet

Copy `.env.example` to `.env` and fill in:

```
MEMWAL_KEY=          # delegate private key from https://memory.walrus.xyz
MEMWAL_ACCOUNT_ID=   # account id from the same dashboard
TATUM_API_KEY=       # free key from https://dashboard.tatum.io
```

Then:

```bash
npm run cli -- loop 3 3   # 3 rounds: bots call, wait 3 min, settle from chain, write lessons (~30 mainnet writes)
npm run cli -- state      # track record, rebuilt from Walrus Memory
npm run cli -- export     # writes web/ledger.json for the static demo
npm start
```

### CLI

```
state | snapshot | bots [min] | resolve | loop [rounds] [min] | coach <voice> <kind> <p> | export | restore
```

## Layout

```
core/     browser-safe engine: codec, markets, scoring, sui (Tatum + GraphQL), engine, bots, local store
node/     Walrus Memory store, HTTP server, CLI
web/      the UI (works against the server, or standalone in the browser)
test/     node:test suite
```

## Limits, honestly

- Recall returns at most 100 results per query, and state is rebuilt from 4 queries, so very large namespaces need paging by time. This is fine at hackathon scale but is the next thing to fix.
- The static demo can't hold Walrus keys, so it stores memory in your browser. The mainnet path runs through the Node server or CLI.
- Markets are limited to things Sui can settle on its own. Sports and elections would need an oracle feed; the market interface (`baseline` / `measure`) is where one would plug in.

## License

MIT
