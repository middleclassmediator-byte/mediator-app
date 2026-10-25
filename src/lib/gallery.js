import { Compass, Ruler, Car, CalendarClock, BadgeCheck, Building2, House, Tag, ShieldCheck, KeyRound, Sparkles } from "lucide-react";

// ---------------------------------------------------------------- parsing

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function parseImageList(p) {
  const parsed = parseJson(p.images, []);
  let urls = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  if (urls.length === 0 && p.imageUrl) urls = [p.imageUrl];
  return urls;
}

export function parseAttributes(p) {
  const parsed = parseJson(p.attributes, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

export const isSold = (p) => p.soldOut === "true" || p.soldOut === true;

/**
 * Reads the first amount out of a free-text price: "₹50,00,000" → 5,000,000,
 * "₹75 Lakhs–₹1 Crore" → 7,500,000 (the first figure, with ITS unit).
 */
export function priceValue(price) {
  if (!price) return null;
  const m = String(price).toLowerCase().match(/(\d[\d,]*\.?\d*)\s*(crores?|cr\b|lakhs?|l\b)?/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  if (Number.isNaN(num)) return null;
  const unit = m[2] || "";
  if (unit.startsWith("cr")) return num * 10000000;
  if (unit.startsWith("l")) return num * 100000;
  return num;
}

/** One tidy object per listing, so every page reads the data the same way. */
export function normalize(p) {
  const attrs = parseAttributes(p);
  // The floor plan/sketch URL travels inside the attributes JSON under a
  // reserved key; take it out so it never shows up as a "detail" card.
  const floorPlan = typeof attrs.__floorPlan === "string" ? attrs.__floorPlan : "";
  delete attrs.__floorPlan;
  const sqft = Number(String(p.sqft || "").replace(/[^\d.]/g, "")) || null;
  const location = p.location || "";
  return {
    id: p.id,
    title: p.title || "Property",
    type: p.type || "",
    location,
    area: location.split(",")[0].trim(),
    price: p.price || "",
    priceNum: priceValue(p.price),
    sqft,
    facing: attrs.Facing || attrs.facing || "",
    attrs,
    floorPlan,
    images: parseImageList(p),
    sold: isSold(p),
    description: p.description || "",
    sellerNote: p.sellerNote || "",
    refId: p.refId || "",
    listedAt: listedTime(p.timestamp),
    pricePerSqft: pricePerSqft(p.price, priceValue(p.price), sqft),
  };
}

function listedTime(ts) {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? null : t;
}

// ₹ per sq.ft only makes sense for one real figure, not a "₹50–75 Lakhs" range
// and not an implausible result (a missing/zero size or a stray price).
function pricePerSqft(priceText, priceNum, sqft) {
  if (!priceNum || !sqft || sqft < 100) return null;
  if (/[–—]|\bto\b|\d\s*-\s*₹?\d/i.test(String(priceText || ""))) return null;
  const v = Math.round(priceNum / sqft);
  return v >= 200 && v <= 500000 ? v : null;
}

// ---------------------------------------------------------------- types

const SHORT_TYPE = {
  "Home / Independent House": "Independent House",
  "Apartment / Flat": "Apartment",
  "Plot / Land": "Plot",
  "Land / Plot": "Plot",
  "Shop / Retail": "Shop",
  "Office / Commercial Space": "Office",
};
export const shortType = (t) => SHORT_TYPE[t] || t;

/** Which icon family a property type belongs to. */
export function typeKind(t) {
  const x = (t || "").toLowerCase();
  if (/apartment|flat/.test(x)) return "apartment";
  if (/plot|land/.test(x)) return "plot";
  if (/shop|retail|office|commercial|hotel|restaurant|saloon/.test(x)) return "commercial";
  return "house";
}

// ---------------------------------------------------------------- specs row

const EXTRA_SPEC_KEYS = [
  ["Building type", Building2],
  ["Parking", Car],
  ["Property age", CalendarClock],
  ["Property usage", House],
  ["Approval status", BadgeCheck],
  ["Purpose", Tag],
];

/**
 * The three small facts shown under a listing (the mockup's "3 BHK / 2400
 * Sq.Ft / East Facing" row). Built only from what the listing really has,
 * so a listing with less data simply shows fewer.
 */
export function specsFor(l) {
  const specs = [];
  for (const [key, icon] of EXTRA_SPEC_KEYS) {
    if (l.attrs[key]) {
      specs.push({ icon, text: String(l.attrs[key]) });
      break;
    }
  }
  if (l.sqft) specs.push({ icon: Ruler, text: `${l.sqft.toLocaleString("en-IN")} Sq.ft` });
  if (l.facing) specs.push({ icon: Compass, text: `${l.facing} Facing` });
  return specs.slice(0, 3);
}

// ---------------------------------------------------------------- filters

export const PRICE_STEPS = [
  { v: 2000000, label: "₹ 20 Lakhs" },
  { v: 3000000, label: "₹ 30 Lakhs" },
  { v: 5000000, label: "₹ 50 Lakhs" },
  { v: 7500000, label: "₹ 75 Lakhs" },
  { v: 10000000, label: "₹ 1 Crore" },
  { v: 20000000, label: "₹ 2 Crores" },
  { v: 30000000, label: "₹ 3 Crores" },
  { v: 50000000, label: "₹ 5+ Crores" },
];
export const SQFT_STEPS = [500, 1000, 1500, 2000, 3000, 4000, 5000];
export const FACINGS = ["All", "North", "South", "East", "West"];

export const DEFAULT_FILTERS = {
  type: "All",
  area: "All",
  priceLo: 0,
  priceHi: PRICE_STEPS.length - 1,
  sqftLo: 0,
  sqftHi: SQFT_STEPS.length - 1,
  facing: "All",
  budget: "any",
};

/** How many sheet filters (not search) differ from their defaults. */
export function activeFilterCount(f) {
  let n = 0;
  if (f.type !== "All") n += 1;
  if (f.area !== "All") n += 1;
  if (f.priceLo !== DEFAULT_FILTERS.priceLo || f.priceHi !== DEFAULT_FILTERS.priceHi) n += 1;
  if (f.sqftLo !== DEFAULT_FILTERS.sqftLo || f.sqftHi !== DEFAULT_FILTERS.sqftHi) n += 1;
  if (f.facing !== "All") n += 1;
  if (f.budget && f.budget !== "any") n += 1;
  return n;
}

export function applyFilters(list, f, query, savedOnly, isSaved) {
  const q = query.trim().toLowerCase();
  const priceTouched = f.priceLo !== DEFAULT_FILTERS.priceLo || f.priceHi !== DEFAULT_FILTERS.priceHi;
  const sqftTouched = f.sqftLo !== DEFAULT_FILTERS.sqftLo || f.sqftHi !== DEFAULT_FILTERS.sqftHi;
  return list.filter((l) => {
    if (q && !(l.title.toLowerCase().includes(q) || l.location.toLowerCase().includes(q) || l.type.toLowerCase().includes(q))) return false;
    if (savedOnly && !isSaved(l.id)) return false;
    if (f.type !== "All" && l.type !== f.type) return false;
    if (f.area !== "All" && l.area !== f.area) return false;
    if (f.facing !== "All" && l.facing.toLowerCase() !== f.facing.toLowerCase()) return false;
    if (f.budget && f.budget !== "any") {
      const band = BUDGET_BANDS.find((b) => b.key === f.budget);
      if (band && (l.priceNum === null || l.priceNum < band.lo || l.priceNum >= band.hi)) return false;
    }
    if (priceTouched) {
      if (l.priceNum === null) return false;
      if (f.priceLo > 0 && l.priceNum < PRICE_STEPS[f.priceLo].v) return false;
      if (f.priceHi < PRICE_STEPS.length - 1 && l.priceNum > PRICE_STEPS[f.priceHi].v) return false;
    }
    if (sqftTouched) {
      if (l.sqft === null) return false;
      if (f.sqftLo > 0 && l.sqft < SQFT_STEPS[f.sqftLo]) return false;
      if (f.sqftHi < SQFT_STEPS.length - 1 && l.sqft > SQFT_STEPS[f.sqftHi]) return false;
    }
    return true;
  });
}

export function sortListings(list, sort) {
  if (sort !== "price-low" && sort !== "price-high") return list;
  return [...list].sort((a, b) => {
    if (a.priceNum === null && b.priceNum === null) return 0;
    if (a.priceNum === null) return 1;
    if (b.priceNum === null) return -1;
    return sort === "price-low" ? a.priceNum - b.priceNum : b.priceNum - a.priceNum;
  });
}

// ---------------------------------------------------------------- budget pills

/** One-tap budget bands shown under the category chips (hi is exclusive). */
export const BUDGET_BANDS = [
  { key: "any", label: "Any budget", lo: 0, hi: Infinity },
  { key: "u30", label: "Under ₹30L", lo: 0, hi: 3000000 },
  { key: "30-50", label: "₹30–50L", lo: 3000000, hi: 5000000 },
  { key: "50-75", label: "₹50–75L", lo: 5000000, hi: 7500000 },
  { key: "75-1cr", label: "₹75L–1Cr", lo: 7500000, hi: 10000000 },
  { key: "1cr+", label: "₹1Cr+", lo: 10000000, hi: Infinity },
];

// ---------------------------------------------------------------- money

/** ₹12,34,567 — Indian digit grouping. */
export const inr = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Short form for big numbers: ₹65 L, ₹1.2 Cr. */
export function inrShort(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const t = (x) => String(Math.round(x * 100) / 100);
  if (n >= 10000000) return `₹${t(n / 10000000)} Cr`;
  if (n >= 100000) return `₹${t(n / 100000)} L`;
  return inr(n);
}

export const EMI_DEFAULTS = { downPct: 20, rate: 8.75, years: 20 };

/** Standard reducing-balance EMI. rate is the yearly % (e.g. 8.75). */
export function emi(principal, ratePct, years) {
  const n = Math.round(years * 12);
  const r = ratePct / 12 / 100;
  if (!(principal > 0) || n <= 0) return { emi: 0, total: 0, interest: 0, months: n };
  const monthly = r === 0 ? principal / n : (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const total = monthly * n;
  return { emi: monthly, total, interest: total - principal, months: n };
}

/** The "EMI from ₹X / month" teaser: default 20% down, 20 years. 0 when it doesn't apply. */
export function emiFrom(l) {
  if (!l.priceNum || l.priceNum < 500000 || l.sold) return 0;
  return emi(l.priceNum * (1 - EMI_DEFAULTS.downPct / 100), EMI_DEFAULTS.rate, EMI_DEFAULTS.years).emi;
}

// ---------------------------------------------------------------- freshness

const DAY_MS = 86400000;

export function listedDays(l) {
  if (!l.listedAt) return null;
  return Math.max(0, Math.floor((Date.now() - l.listedAt) / DAY_MS));
}

export const isNew = (l) => {
  const d = listedDays(l);
  return d !== null && d <= 14 && !l.sold;
};

export function listedAgo(l) {
  const d = listedDays(l);
  if (d === null) return "";
  if (d === 0) return "Listed today";
  if (d === 1) return "Listed yesterday";
  if (d < 14) return `Listed ${d} days ago`;
  if (d < 60) return `Listed ${Math.floor(d / 7)} weeks ago`;
  return `Listed ${Math.floor(d / 30)} months ago`;
}

// ---------------------------------------------------------------- trust highlights

/**
 * Short reassurance chips built ONLY from what the seller actually told us
 * (approvals, loan status, parking…). Nothing is added that isn't in the data.
 */
export function highlightsFor(l) {
  const find = (re) => {
    const key = Object.keys(l.attrs).find((k) => re.test(k));
    return key ? String(l.attrs[key] || "").trim() : "";
  };
  const out = [];
  const patta = find(/patta/i);
  if (patta && !/not approved/i.test(patta)) out.push({ icon: BadgeCheck, text: /patta/i.test(patta) ? patta : `${patta} approved` });
  const approval = find(/^approval status/i);
  if (approval && !/not/i.test(approval)) out.push({ icon: BadgeCheck, text: approval });
  const loan = find(/loan status/i);
  if (/no loan/i.test(loan)) out.push({ icon: ShieldCheck, text: "No loan on the property" });
  else if (/closed/i.test(loan)) out.push({ icon: ShieldCheck, text: "Loan cleared" });
  if (/vacant/i.test(find(/rental/i))) out.push({ icon: KeyRound, text: "Vacant, ready to move in" });
  if (/brand new/i.test(l.description)) out.push({ icon: Sparkles, text: "Brand new" });
  const parking = find(/parking/i);
  if (parking && !/^no\b/i.test(parking)) out.push({ icon: Car, text: /^(yes|available|y)$/i.test(parking) ? "Parking available" : parking });
  if (l.facing) out.push({ icon: Compass, text: `${l.facing} facing` });
  return out.slice(0, 6);
}

// ---------------------------------------------------------------- collections

/**
 * Curated rails for the gallery home, built from real data. A rail only
 * appears when at least two listings qualify, so it never looks empty.
 */
export function collectionsFor(list, max = 4) {
  const live = list.filter((l) => !l.sold && l.images.length > 0);
  const defs = [
    { key: "new", title: "Just listed", subtitle: "Added in the last two weeks", pick: (l) => isNew(l) },
    { key: "budget", title: "Under ₹50 Lakhs", subtitle: "Comfortable on the budget", pick: (l) => l.priceNum !== null && l.priceNum < 5000000 },
    { key: "east", title: "East-facing", subtitle: "Morning light, Vastu-friendly", pick: (l) => /east/i.test(l.facing) },
    { key: "parking", title: "With parking", subtitle: "Space for your car or bike", pick: (l) => highlightsFor(l).some((h) => h.icon === Car) },
    { key: "newbuild", title: "Brand new", subtitle: "Never lived in", pick: (l) => /brand new/i.test(l.description) },
    { key: "plots", title: "Plots & land", subtitle: "Build your own", pick: (l) => typeKind(l.type) === "plot" },
  ];
  return defs
    .map((d) => ({ ...d, items: live.filter(d.pick).slice(0, 8) }))
    .filter((d) => d.items.length >= 2)
    .slice(0, max)
    .map(({ pick, ...rest }) => rest); // eslint-disable-line no-unused-vars
}

/** Listings like this one: same kind of property, close in price, nearest first. */
export function similarTo(l, list, limit = 6) {
  return list
    .filter((x) => x.id !== l.id && !x.sold && x.images.length > 0)
    .map((x) => {
      let score = 0;
      if (x.type && x.type === l.type) score += 3;
      else if (typeKind(x.type) === typeKind(l.type)) score += 1;
      if (x.area && x.area === l.area) score += 2;
      if (l.priceNum && x.priceNum) {
        const gap = Math.abs(x.priceNum - l.priceNum) / l.priceNum;
        if (gap <= 0.25) score += 3;
        else if (gap <= 0.5) score += 1;
      }
      return { x, score };
    })
    .filter((r) => r.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.x);
}

/** Facts for the compare sheet: the best value in each row gets highlighted. */
export function compareRows(items) {
  const best = (vals, lowIsBetter) => {
    const nums = vals.map((v) => (typeof v === "number" ? v : null));
    const valid = nums.filter((n) => n !== null);
    if (valid.length < 2) return -1;
    const target = lowIsBetter ? Math.min(...valid) : Math.max(...valid);
    if (new Set(valid).size === 1) return -1;
    return nums.indexOf(target);
  };
  const attr = (l, re) => {
    const k = Object.keys(l.attrs).find((x) => re.test(x));
    return k ? String(l.attrs[k]) : "";
  };
  const rows = [
    { label: "Price", cells: items.map((l) => l.price || "On request"), best: best(items.map((l) => l.priceNum), true) },
    { label: "Price per sq.ft", cells: items.map((l) => (l.pricePerSqft ? inr(l.pricePerSqft) : "—")), best: best(items.map((l) => l.pricePerSqft), true) },
    { label: "EMI from", cells: items.map((l) => (emiFrom(l) ? `${inr(emiFrom(l))}/mo` : "—")), best: best(items.map((l) => emiFrom(l) || null), true) },
    { label: "Size", cells: items.map((l) => (l.sqft ? `${l.sqft.toLocaleString("en-IN")} sq.ft` : "—")), best: best(items.map((l) => l.sqft), false) },
    { label: "Type", cells: items.map((l) => shortType(l.type) || "—"), best: -1 },
    { label: "Area", cells: items.map((l) => l.area || "—"), best: -1 },
    { label: "Facing", cells: items.map((l) => l.facing || "—"), best: -1 },
    { label: "Parking", cells: items.map((l) => attr(l, /parking/i) || "—"), best: -1 },
    { label: "Approval", cells: items.map((l) => attr(l, /patta|^approval/i) || "—"), best: -1 },
    { label: "Loan", cells: items.map((l) => attr(l, /loan status/i) || "—"), best: -1 },
    { label: "Listed", cells: items.map((l) => listedAgo(l).replace("Listed ", "") || "—"), best: -1 },
  ];
  return rows.filter((r) => r.cells.some((c) => c !== "—"));
}
