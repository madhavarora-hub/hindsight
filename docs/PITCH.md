# Pitch

**One line:** Hindsight is a forecasting coach that remembers who was right. Calls settle from Sui mainnet via Tatum RPC, and every call, result and lesson lives in Walrus Memory, so the app learns whose "90%" to trust.

**Short (about 100 words):**
Prediction apps track picks. Hindsight tracks calibration: when someone says 80%, how often does it actually happen? You log a call on something Sui can settle itself (the Cetus SUI price, gas price, network throughput, a balance). At the deadline, Hindsight reads the answer from a mainnet checkpoint through Tatum's Sui RPC and stores it, with the evidence, in Walrus Memory. Each voice builds a track record, and Hindsight writes plain-English lessons when someone drifts. The next time that voice calls, Hindsight recalls the record and coaches the number live. Walrus Memory is the only database, so the whole track record is portable.

**Why it fits the judging criteria:**
- *Walrus + Tatum (30%)*: memory is the entire state (write, semantic recall for coaching, rebuild-from-recall, restore). Tatum Sui RPC settles every call, and the Tatum Data API is the off-chain reference for flagging source disagreement.
- *Technical quality (30%)*: pure scoring module, a tested engine (17 tests, including rebuild-from-memory), idempotent writes, Q64.64 price math checked against market data, and evidence (checkpoint and digest) stored with every result.
- *Creativity (20%)*: the memory doesn't just store picks. It changes the number you log, and shows the memories that justify the change.
- *Presentation (20%)*: a keyless live demo on GitHub Pages, a mainnet ledger with blob IDs, and a README that states its limits.

**Track:** Markets & Sports Prediction. Also eligible for: Best Walrus Memory (the learning loop visibly changes the product).
