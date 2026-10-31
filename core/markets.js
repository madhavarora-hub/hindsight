// Market kinds: things you can forecast that the chain itself can settle.
// Each kind knows how to snapshot a baseline when a call is logged and how to
// measure the outcome when the deadline passes.

export const KINDS = {
  sui_price: {
    label: "SUI price (Cetus USDC/SUI pool)",
    unit: "USD",
    async baseline(sui) {
      const p = await sui.suiPrice();
      return { value: p.usd };
    },
    async measure(sui) {
      const p = await sui.suiPrice();
      return { value: p.usd, extra: { objectVersion: p.objectVersion, objectDigest: p.objectDigest } };
    },
    describe: (f) => `SUI will trade ${word(f.op)} $${fmt(f.threshold, 4)} on Cetus at ${when(f.deadlineMs)}`,
  },

  network_tx: {
    label: "Sui network transactions in the window",
    unit: "tx",
    async baseline(sui) {
      const cp = await sui.checkpoint();
      return { value: cp.networkTotalTransactions, checkpointSeq: cp.seq, timestampMs: cp.timestampMs };
    },
    // Counts transactions from the baseline checkpoint to the first checkpoint
    // seen after the deadline. Late resolution inflates the count, so it is
    // prorated back to the forecast window using checkpoint timestamps.
    async measure(sui, f, cp) {
      const total = cp.networkTotalTransactions - f.baseline.value;
      const elapsed = cp.timestampMs - f.baseline.timestampMs;
      const windowMs = f.deadlineMs - f.baseline.timestampMs;
      const value = elapsed > windowMs && elapsed > 0 ? Math.round((total * windowMs) / elapsed) : total;
      return { value, extra: { rawTotal: total, elapsedMs: elapsed } };
    },
    describe: (f) =>
      `Sui will process ${word(f.op, "more", "fewer")} than ${Math.round(f.threshold).toLocaleString("en-US")} transactions by ${when(f.deadlineMs)}`,
  },

  gas_price: {
    label: "Sui reference gas price",
    unit: "MIST",
    async baseline(sui) {
      return { value: await sui.referenceGasPrice() };
    },
    async measure(sui) {
      return { value: await sui.referenceGasPrice() };
    },
    describe: (f) => `Sui reference gas price will be ${word(f.op)} ${f.threshold} MIST at ${when(f.deadlineMs)}`,
  },

  balance: {
    label: "SUI balance of an address",
    unit: "SUI",
    async baseline(sui, f) {
      return { value: await sui.balanceSui(f.params.address) };
    },
    async measure(sui, f) {
      return { value: await sui.balanceSui(f.params.address) };
    },
    describe: (f) =>
      `${short(f.params?.address)} will hold ${word(f.op)} ${fmt(f.threshold, 2)} SUI at ${when(f.deadlineMs)}`,
  },
};

export function describe(f) {
  return KINDS[f.kind].describe(f);
}

export function validateForecast(f) {
  const errors = [];
  if (!KINDS[f.kind]) errors.push(`unknown kind ${f.kind}`);
  if (!(f.p > 0 && f.p < 1)) errors.push("p must be strictly between 0 and 1");
  if (f.op !== ">" && f.op !== "<") errors.push("op must be > or <");
  if (!Number.isFinite(f.threshold)) errors.push("threshold must be a number");
  if (!Number.isFinite(f.deadlineMs) || f.deadlineMs <= f.createdMs) errors.push("deadline must be after creation");
  if (!f.voice || typeof f.voice !== "string") errors.push("voice is required");
  if (f.kind === "balance" && !/^0x[0-9a-fA-F]{1,64}$/.test(f.params?.address ?? "")) errors.push("balance needs params.address");
  if (errors.length) throw new Error(`invalid forecast: ${errors.join("; ")}`);
}

/** Did the YES side happen? */
export function settle(op, observed, threshold) {
  return op === ">" ? observed > threshold : observed < threshold;
}

function word(op, gt = "above", lt = "below") {
  return op === ">" ? gt : lt;
}
function fmt(n, d) {
  return Number(n).toFixed(d);
}
function when(ms) {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
function short(a = "") {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a;
}
