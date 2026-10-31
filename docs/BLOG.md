# Hindsight: teaching an app who to trust, with Walrus Memory and Tatum

*Draft blog post for the Total Recall hackathon. Fill in the bracketed numbers from your own mainnet run before publishing.*

Everyone has a friend who is "90% sure" about everything. After a few months you learn to quietly translate their 90% into something closer to a coin flip. Hindsight is an app that learns that translation for you, and keeps it.

## What it does

You log a call about something the Sui blockchain can settle on its own: the SUI price on the Cetus USDC/SUI pool, the network's reference gas price, how many transactions Sui will process in a window, or an address's balance. You give a confidence, say 70%.

When the deadline passes, Hindsight reads the answer from a Sui mainnet checkpoint and stores the result, with the checkpoint number and digest as evidence. Over time each voice (you, an analyst you follow, or one of the house bots) builds a track record: hit rate, Brier skill, and a verdict such as "overconfident" or "calibrated, adds signal".

The interesting part is what happens next time. While you type a name and drag the confidence slider, Hindsight recalls that voice's history and says, for example: *"hype-hal on sui_price calls near 90%: 0/6 came true. Hindsight suggests 51% instead of 90%."* You can log your own number or Hindsight's. Both are kept, so you can later see whether the coaching helped.

## How it uses Walrus Memory

Walrus Memory is Hindsight's only database. There is no Postgres and no local state that matters. Every forecast, resolution and lesson is a memory written to mainnet through the Walrus Memory relayer, which embeds it, encrypts it with SEAL and stores it as a Walrus blob.

Each memory has two parts:

1. **A plain-English sentence**, so semantic recall works: "hype-hal (bot) said 90% that SUI will trade above $0.9140… NO happened, so the call was wrong."
2. **A compact machine tag**, so the app can rebuild its exact state from recall results alone.

Because state lives in memory, it is portable. On startup Hindsight rebuilds open calls, the whole track record and every lesson from recall. Run it on a second laptop with the same Walrus Memory account and it picks up mid-sentence. If the index is ever lost, `restore` re-indexes the namespace from the Walrus blobs.

Recall does two jobs: rebuilding state, and **justifying advice**. Next to every suggestion the UI shows the memories it recalled, so the number never comes out of a black box.

## How it uses Tatum

All chain reads go through the **Tatum Sui RPC gateway** (`sui-mainnet.gateway.tatum.io`):

- `sui_getLatestCheckpointSequenceNumber` and `sui_getCheckpoint` give the evidence for every resolution, plus network throughput.
- `sui_getObject` reads the Cetus pool's `current_sqrt_price`, a Q64.64 fixed-point number that Hindsight converts to USD per SUI.
- `suix_getReferenceGasPrice` and `suix_getBalance` settle the gas and balance markets.

The **Tatum Data API** exchange rate serves as an off-chain reference. When the on-chain pool price and Tatum's rate differ by more than 1%, the dashboard flags that the sources disagree, which is exactly when a forecast about "the price" needs care.

## How it learned over time

*[Replace with your own numbers after the mainnet run.]*

We let four house bots, each a fixed and published rule, make calls on live Sui data in short windows:

- **hype-hal** always says 90% that SUI is up 0.3% within minutes.
- **steady-sam** says 52% that SUI ends the window higher.
- **tx-tina** says 65% that throughput holds at the recent rate.
- **gas-gary** says 95% that the gas price doesn't move.

After [N] rounds and [W] mainnet memory writes:

- hype-hal was right [x/y] times. After its third miss, Hindsight wrote the lesson "hype-hal is overconfident on sui_price calls…" to Walrus Memory. From then on, a 90% from hal is coached down to about [z]%.
- gas-gary was right [x/y] times and is rated "calibrated".
- [what happened with tina and sam]

None of this was hard-coded. It came out of the record, and the record lives on Walrus.

## What's next

- Oracle-backed markets for sports and elections, using the same `baseline` / `measure` interface.
- Group leagues: one namespace per league, with shared lessons.
- Agent payments: let an AI analyst pay per settled call via x402 on Sui, and get paid more when it is calibrated.

Code: https://github.com/madhavarora-hub/hindsight · Demo: https://madhavarora-hub.github.io/hindsight/
