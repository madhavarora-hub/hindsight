# Demo video script (about 2.5 minutes)

**Setup before recording:** `.env` filled in (Walrus Memory and Tatum keys), at least 3 completed rounds of `npm run cli -- loop 3 3` so hype-hal already has a lesson, and `npm start` running. Use a 1440x900 browser window and turn on screen-recorder captions if available.

| # | Time | On screen | Say |
|---|---|---|---|
| 1 | 0:00–0:15 | The Hindsight page. Point at the two green badges. | "This is Hindsight, a forecasting coach that remembers who was right. Memory is Walrus Memory on mainnet. Chain data comes from Tatum's Sui RPC." |
| 2 | 0:15–0:30 | The live strip: Cetus price, Tatum rate, gas, throughput. | "Everything here is read live from Sui mainnet through Tatum. We compare the on-chain Cetus price with Tatum's off-chain rate and flag it when they disagree." |
| 3 | 0:30–1:00 | Type `hype-hal (bot)` as the voice and drag confidence to 90%. The coach box updates. Open "Recalled from memory". | "Watch the coach. I'm about to log a 90% call from hal. Hindsight recalls hal's record from Walrus Memory: 0 out of 6 at 90%. It suggests about 51%, and these are the memories behind that suggestion." |
| 4 | 1:00–1:15 | Click "Log Hindsight's number". The open list shows "coached from 90%". | "I log the coached number. Both numbers are kept, so we can grade the coaching itself later." |
| 5 | 1:15–1:40 | Type your own name with a fresh market (gas below 101, 3 min, 80%). Log it. Then show the Settled list with ✓/✗ and checkpoint numbers. | "A new voice has no record, so Hindsight keeps my number. When the deadline passes, the outcome is read from a Sui checkpoint, and that checkpoint goes into memory as evidence." |
| 6 | 1:40–2:00 | The Who to trust table and the calibration chart (hover a dot). | "Every voice gets a hit rate, a Brier skill score and a verdict. On the chart, the dashed line is perfect calibration. hal's dot sits far below it." |
| 7 | 2:00–2:20 | Terminal: stop the server, run `npm run cli -- state` (ideally on a second machine or in a clean clone with the same `.env`). | "Walrus Memory is the only database. A fresh process rebuilds every call, result and lesson from recall alone. The memory is portable." |
| 8 | 2:20–2:35 | The Memory panel: click a blob ID, which opens Walruscan. | "Every line is a Walrus blob on mainnet. Hindsight: it learns who to trust, and it doesn't forget." |

**Recording tips:** keep the cursor slow, zoom the browser to 110%, and don't show the `.env` file or any keys.
