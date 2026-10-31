// On-chain data sources. Hindsight resolves every forecast against Sui mainnet.
//
// TatumSui is the primary source: Sui JSON-RPC through the Tatum gateway.
// SuiGraphQL is a keyless fallback so the public demo works before you have a
// Tatum key. Both return the same shapes, so the rest of the app never knows
// which one answered (except via `.name`, which ends up in every receipt).

export const TATUM_SUI_MAINNET = "https://sui-mainnet.gateway.tatum.io";
export const SUI_GRAPHQL_MAINNET = "https://graphql.mainnet.sui.io/graphql";

// Cetus CLMM pool: native Circle USDC / SUI, 0.25% fee tier.
export const CETUS_USDC_SUI_POOL =
  "0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105";
const USDC_DECIMALS = 6;
const SUI_DECIMALS = 9;
export const MIST_PER_SUI = 1_000_000_000n;

/**
 * Cetus stores sqrt(price) as a Q64.64 fixed-point number, where price is
 * (raw coin_b per raw coin_a) = raw SUI per raw USDC. Convert to USD per SUI.
 */
export function cetusSqrtPriceToUsdPerSui(sqrtPriceX64) {
  const sqrt = Number(BigInt(sqrtPriceX64)) / 2 ** 64;
  const rawSuiPerRawUsdc = sqrt * sqrt;
  const suiPerUsdc = rawSuiPerRawUsdc * 10 ** (USDC_DECIMALS - SUI_DECIMALS);
  return 1 / suiPerUsdc;
}

export class TatumSui {
  constructor({ apiKey, url = TATUM_SUI_MAINNET, fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
    if (!apiKey) throw new Error("TatumSui needs a Tatum API key (dashboard.tatum.io)");
    this.name = "tatum-sui-rpc";
    this.url = url;
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.calls = 0;
  }

  async rpc(method, params = []) {
    this.calls += 1;
    const res = await this.fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.calls, method, params }),
    });
    if (!res.ok) throw new Error(`Tatum ${method}: HTTP ${res.status} ${await res.text()}`);
    const body = await res.json();
    if (body.error) throw new Error(`Tatum ${method}: ${body.error.message}`);
    return body.result;
  }

  async checkpoint() {
    return this.checkpointAt(await this.rpc("sui_getLatestCheckpointSequenceNumber"));
  }

  async checkpointAt(seq) {
    const cp = await this.rpc("sui_getCheckpoint", [String(seq)]);
    return {
      seq: Number(cp.sequenceNumber),
      digest: cp.digest,
      timestampMs: Number(cp.timestampMs),
      networkTotalTransactions: Number(cp.networkTotalTransactions),
      epoch: Number(cp.epoch),
    };
  }

  async suiPrice() {
    const obj = await this.rpc("sui_getObject", [CETUS_USDC_SUI_POOL, { showContent: true }]);
    const fields = obj?.data?.content?.fields;
    if (!fields?.current_sqrt_price) throw new Error("Cetus pool has no current_sqrt_price");
    return {
      usd: cetusSqrtPriceToUsdPerSui(fields.current_sqrt_price),
      objectVersion: Number(obj.data.version),
      objectDigest: obj.data.digest,
    };
  }

  async referenceGasPrice() {
    return Number(await this.rpc("suix_getReferenceGasPrice"));
  }

  async balanceSui(address) {
    const b = await this.rpc("suix_getBalance", [address, "0x2::sui::SUI"]);
    return Number(BigInt(b.totalBalance)) / Number(MIST_PER_SUI);
  }
}

export class SuiGraphQL {
  constructor({ url = SUI_GRAPHQL_MAINNET, fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
    this.name = "sui-graphql-fallback";
    this.url = url;
    this.fetch = fetchImpl;
    this.calls = 0;
  }

  async gql(query, variables = {}) {
    this.calls += 1;
    const res = await this.fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Sui GraphQL: HTTP ${res.status}`);
    const body = await res.json();
    if (body.errors?.length) throw new Error(`Sui GraphQL: ${body.errors[0].message}`);
    return body.data;
  }

  async checkpoint() {
    return this.checkpointAt(null);
  }

  async checkpointAt(seq) {
    const fields = "sequenceNumber digest timestamp networkTotalTransactions epoch { epochId }";
    const d =
      seq == null
        ? await this.gql(`{ checkpoint { ${fields} } }`)
        : await this.gql(`query($s: UInt53!) { checkpoint(sequenceNumber: $s) { ${fields} } }`, { s: Number(seq) });
    const cp = d.checkpoint;
    return {
      seq: Number(cp.sequenceNumber),
      digest: cp.digest,
      timestampMs: Date.parse(cp.timestamp),
      networkTotalTransactions: Number(cp.networkTotalTransactions),
      epoch: Number(cp.epoch.epochId),
    };
  }

  async suiPrice() {
    const d = await this.gql(
      "query($a: SuiAddress!) { object(address: $a) { version digest asMoveObject { contents { json } } } }",
      { a: CETUS_USDC_SUI_POOL },
    );
    const o = d.object;
    return {
      usd: cetusSqrtPriceToUsdPerSui(o.asMoveObject.contents.json.current_sqrt_price),
      objectVersion: Number(o.version),
      objectDigest: o.digest,
    };
  }

  async referenceGasPrice() {
    const d = await this.gql("{ epoch { referenceGasPrice } }");
    return Number(d.epoch.referenceGasPrice);
  }

  async balanceSui(address) {
    const d = await this.gql(
      'query($a: SuiAddress!) { address(address: $a) { balance(coinType: "0x2::sui::SUI") { totalBalance } } }',
      { a: address },
    );
    const raw = d.address?.balance?.totalBalance ?? "0";
    return Number(BigInt(raw)) / Number(MIST_PER_SUI);
  }
}

/** Off-chain reference rate from the Tatum Data API, used to flag source disagreement. */
export async function tatumUsdRate({ apiKey, symbol = "SUI", fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(`https://api.tatum.io/v3/tatum/rate/${symbol}?basePair=USD`, {
    headers: { "x-api-key": apiKey },
  });
  if (!res.ok) throw new Error(`Tatum rate: HTTP ${res.status}`);
  const body = await res.json();
  const usd = Number(body.value);
  if (!Number.isFinite(usd)) throw new Error("Tatum rate: no value");
  return { usd, source: body.source ?? "tatum", timestampMs: Number(body.timestamp) || Date.now() };
}

export function makeSui({ tatumApiKey, fetchImpl } = {}) {
  return tatumApiKey ? new TatumSui({ apiKey: tatumApiKey, fetchImpl }) : new SuiGraphQL({ fetchImpl });
}
