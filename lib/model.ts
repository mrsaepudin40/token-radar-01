// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// pre-token protocol below the watchlist floor that passes the same no-token / not-a-product test the
// watchlist itself passed. A protocol is pre-token when its index entry records no token (no market
// cap, no CoinGecko id, no symbol); the snapshot's live-token protocols are kept apart and shown as
// the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, never from a hand-written list of names:
//
//   multiple   = the category's median mcap/TVL among the snapshot's own live protocols, shrunk
//                toward the global median (weight 20), clamped [0.05, 1.0]; a category with fewer
//                than 5 live comps is capped at 0.35, so one outlier cannot decide the board.
//                A category with no live comps falls back to the global median.
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity))
//
// A flat multiple would overvalue Lending and Yield (live medians 0.132 and 0.121) and undervalue
// Dexs and Basis Trading (0.342 and 0.482); the market's own medians say what a launch is worth.
// The one trap in the snapshot: Risk Curators rest on a single live comp (an oracle token at 2.975x),
// so the small-sample cap is what keeps the top of the board honest.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** How strongly a category's median is pulled toward the global median. */
  shrink_weight: number;
  /** The ceiling for a category with fewer than `small_n` live comps. */
  small_n_cap: number;
  /** Below this many live comps a category is small. */
  small_n: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink_weight: 20,
  small_n_cap: 0.35,
  small_n: 5,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many top rows carry the extra risk step in their farm plan. */
export const RISK_STEP_ROWS = 40;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's multiple, as the dashboard's comps table shows it. */
export interface CategoryMultiple {
  category: string;
  comps: number;
  median: number;
  multiple: number;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  multiples: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of sorted numbers: the middle one, or the mean of the two middles. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * Every category's multiple, computed at runtime from the snapshot's own live protocols (a market
 * cap and a positive TVL), plus the global median they shrink toward. A category with no live comps
 * falls back to the global median; a category with few comps is capped, so one outlier cannot set it.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { multiples: Map<string, number>; table: CategoryMultiple[]; globalMedian: number } {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const globalMedian = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? '';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, list);
  }
  const multiples = new Map<string, number>();
  const table: CategoryMultiple[] = [];
  const categories = [...new Set(snapshot.protocols.map((p) => p.category).filter((c): c is string => c !== null))].sort();
  for (const category of categories) {
    const values = byCategory.get(category) ?? [];
    let multiple: number;
    let med: number;
    if (values.length === 0) {
      multiple = round4(globalMedian);
      med = round4(globalMedian);
    } else {
      med = median(values);
      const shrunk = (values.length * med + model.shrink_weight * globalMedian) / (values.length + model.shrink_weight);
      const cap = values.length < model.small_n ? model.small_n_cap : model.multiple_cap;
      multiple = round4(Math.min(cap, Math.max(model.multiple_floor, shrunk)));
    }
    multiples.set(category, multiple);
    table.push({ category, comps: values.length, median: round4(med), multiple });
  }
  table.sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { multiples, table, globalMedian: round4(globalMedian) };
}

/** The multiple for one protocol's category, or the global median when its category has none. */
export function multipleFor(category: string | null, multiples: Map<string, number>, globalMedian: number): number {
  if (category === null) return globalMedian;
  return multiples.get(category) ?? globalMedian;
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  categoryMultiple: number,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * categoryMultiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A wrapped or staked product's name: a token that already exists in another form. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;

/** Categories the watchlist itself excludes: a token there would be a product of one that trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Centralised-exchange names: a row named after one is the exchange's own product. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool,
 * not in one of the watchlist's excluded categories, and not a wrapped or staked product. The same
 * test the watchlist passed, applied to the whole board.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { multiples, globalMedian } = categoryMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable protocol below the watchlist floor, by TVL. No cap: the board is
  // the whole clean set, not a top slice of it. Never a replacement for a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const categoryMultiple = multipleFor(p.category, multiples, globalMedian);
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, categoryMultiple, model);
    return { p, implied, growthPct, growthMult, maturityMult, age, categoryMultiple };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const steps = farmSteps(s.p, s.age);
    // The top rows carry one more step: the implied value is a model, never a promise.
    if (i < RISK_STEP_ROWS) {
      steps.push({
        text: `Implied value is a model, not a promise: this row's $${s.implied.toLocaleString('en-US')} is what the token could be worth if the protocol's record stayed as it is, never a guarantee it issues one.`,
        cost: 'nothing but the check',
        time: '5 minutes',
      });
    }
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        category_multiple: s.categoryMultiple,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
      },
      farm_steps: steps.map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/**
 * What one transaction costs on a protocol's first chain: an Ethereum L1 transaction costs dollars,
 * a Solana one cents, and the L2s and BNB Chain sit between them. The farm plan states the chain's
 * own cost instead of one flat gas figure.
 */
function gasFor(chain: string): { first: string; action: string; weekly: string } {
  if (chain === 'Ethereum') return { first: '$15', action: '$10', weekly: '$5' };
  if (chain === 'Solana') return { first: '$0.10', action: '$0.10', weekly: '$0.10' };
  if (chain === 'Binance') return { first: '$1', action: '$0.50', weekly: '$0.20' };
  if (['Arbitrum', 'Optimism', 'Base', 'Polygon', 'zkSync Era', 'Blast', 'Linea', 'Scroll', 'Mantle', 'Avalanche', 'Fantom', 'Gnosis'].includes(chain)) {
    return { first: '$2', action: '$1', weekly: '$0.50' };
  }
  return { first: '$3', action: '$2', weekly: '$1' };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `under ${gas.first} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about ${gas.action} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about ${gas.weekly} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { table } = categoryMultiples(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    multiples: table,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** How many movers each side of the Top Movers panel carries. */
export const TOP_MOVERS = 15;

/** One row of the Top Movers panel: a board protocol's seven-day move and its implied value. */
export interface MoverRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  change_7d: number;
  /** The seven-day change clamped to the model's growth window, the same clamp impliedValue uses. */
  growth_pct: number;
  tvl_usd: number;
  implied_value_usd: number;
}

/** The Top Movers panel's two lists, plus how the whole board moved. */
export interface MoversData {
  gainers: MoverRow[];
  losers: MoverRow[];
  /** Board rows with a recorded seven-day change. */
  recorded: number;
  /** Of the recorded rows, how many rose, fell, or were flat. */
  risers: number;
  fallers: number;
  flat: number;
  /** Board rows with no seven-day change on record, so no momentum to rank. */
  unrecorded: number;
}

/**
 * The board's momentum, both ways: the steepest seven-day risers and the steepest fallers.
 * Momentum is the same clamped change_7d the model scores with (MODEL.growth_floor to
 * MODEL.growth_cap), so a mover's rank here and its growth multiplier in the board agree.
 * Rows with no change_7d on record are left out of both lists and counted as unrecorded:
 * an unknown week is not a flat week. Ties break toward the larger implied value, then slug.
 */
export function topMovers(board: BoardRow[], model: ModelConstants = MODEL, limit: number = TOP_MOVERS): MoversData {
  const scored: MoverRow[] = [];
  let risers = 0;
  let fallers = 0;
  let flat = 0;
  let unrecorded = 0;
  for (const r of board) {
    if (r.change_7d === null) {
      unrecorded += 1;
      continue;
    }
    const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, r.change_7d));
    if (growthPct > 0) risers += 1;
    else if (growthPct < 0) fallers += 1;
    else flat += 1;
    scored.push({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      change_7d: r.change_7d,
      growth_pct: growthPct,
      tvl_usd: r.tvl_usd,
      implied_value_usd: r.implied_value_usd,
    });
  }
  const byRise = (a: MoverRow, b: MoverRow): number =>
    b.growth_pct - a.growth_pct || b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const byFall = (a: MoverRow, b: MoverRow): number =>
    a.growth_pct - b.growth_pct || b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  return {
    gainers: [...scored].sort(byRise).slice(0, limit),
    losers: [...scored].sort(byFall).slice(0, limit),
    recorded: scored.length,
    risers,
    fallers,
    flat,
    unrecorded,
  };
}

/** One row of the Chain Breakdown panel: a chain's share of the board. */
export interface ChainRow {
  chain: string;
  protocols: number;
  total_implied_value_usd: number;
  /** This chain's share of the board's total implied value, in per cent. */
  share_pct: number;
  /** The mean of the category multiples of the chain's protocols. */
  avg_multiple: number;
  /** The chain's largest protocol by implied value. */
  top_protocol: string;
  top_implied_value_usd: number;
}

/** The Chain Breakdown panel: every chain on the board, strongest first. */
export interface ChainBreakdownData {
  chains: ChainRow[];
  total_implied_value_usd: number;
  /** The share of the board's implied value the top three chains hold together. */
  top3_share_pct: number;
}

/**
 * Where the board's implied value sits, by chain. Each protocol counts toward the first chain it
 * names, so the shares add to 100% and no dollar is counted twice: a multi-chain protocol is
 * attributed to its primary chain, not split across all of them. Chains with no board protocol
 * do not appear. The average multiple is the mean of the chain's protocols' category multiples,
 * so a chain of high-multiple categories reads higher than a chain of low-multiple ones.
 */
export function chainBreakdown(board: BoardRow[]): ChainBreakdownData {
  const byChain = new Map<string, { count: number; total: number; multiples: number; top: string; topImplied: number }>();
  let total = 0;
  for (const r of board) {
    const chain = r.chains.length > 0 ? r.chains[0]! : 'Unknown';
    total += r.implied_value_usd;
    const agg = byChain.get(chain) ?? { count: 0, total: 0, multiples: 0, top: '', topImplied: 0 };
    agg.count += 1;
    agg.total += r.implied_value_usd;
    agg.multiples += r.model.category_multiple;
    if (r.implied_value_usd > agg.topImplied) {
      agg.top = r.name;
      agg.topImplied = r.implied_value_usd;
    }
    byChain.set(chain, agg);
  }
  const chains: ChainRow[] = [...byChain.entries()]
    .map(([chain, agg]) => ({
      chain,
      protocols: agg.count,
      total_implied_value_usd: agg.total,
      share_pct: total > 0 ? Math.round((agg.total / total) * 10000) / 100 : 0,
      avg_multiple: round4(agg.multiples / agg.count),
      top_protocol: agg.top,
      top_implied_value_usd: agg.topImplied,
    }))
    .sort((a, b) => b.total_implied_value_usd - a.total_implied_value_usd || (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0));
  const top3 = chains.slice(0, 3).reduce((s, c) => s + c.total_implied_value_usd, 0);
  return {
    chains,
    total_implied_value_usd: total,
    top3_share_pct: total > 0 ? Math.round((top3 / total) * 10000) / 100 : 0,
  };
}

/** A compact data.js that also carries the Top Movers and Chain Breakdown panels. */
export function dataScriptExtended(radar: RadarData, movers: MoversData, chains: ChainBreakdownData): string {
  return `window.RADAR=${JSON.stringify({ ...radar, movers, chains })};\n`;
}
