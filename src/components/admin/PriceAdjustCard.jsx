import { Minus, Plus, RotateCcw } from "lucide-react";
import { Chip } from "./ui";
import { adminInputCls } from "./styles";

const LAKH = 100000;
const CRORE = 10000000;

// Rough min/max (in ₹) for each of the seller form's price bands, in the same
// order as the band list passed in. Used only to give the slider a sensible
// starting range — the exact price can always go outside it.
const BAND_RANGES = [
  [5 * LAKH, 30 * LAKH],
  [30 * LAKH, 50 * LAKH],
  [50 * LAKH, 75 * LAKH],
  [75 * LAKH, 1 * CRORE],
  [1 * CRORE, 3 * CRORE],
];
const FALLBACK_RANGE = [5 * LAKH, 2 * CRORE];

const STEPS = [
  { label: "5L", delta: 5 * LAKH },
  { label: "1L", delta: 1 * LAKH },
  { label: "10K", delta: 10000 },
];

const digits = (v) => String(v ?? "").replace(/[^\d]/g, "");
const fmt = (n) => Number(n).toLocaleString("en-IN");

function words(n) {
  if (!n) return "";
  const trim = (x) => String(Number(x.toFixed(2)));
  if (n >= CRORE) return `${trim(n / CRORE)} Crore`;
  if (n >= LAKH) return `${trim(n / LAKH)} Lakhs`;
  return `${fmt(n)}`;
}

/**
 * Admin card for fixing the real asking price. A small box at the top takes a
 * typed amount; the big figure below updates live as the slider or the ±
 * buttons move it. The seller's own price band stays alongside as context.
 *
 * Reads/writes the existing `exactPrice` (digits only) and `expectedPrice`
 * (band text) lead fields, so nothing changes in the backend.
 */
export default function PriceAdjustCard({ bands, expectedPrice, exactPrice, accent, onChange }) {
  const value = Number(digits(exactPrice)) || 0;
  const bandIndex = bands.indexOf(expectedPrice);
  const [bandMin, bandMax] = BAND_RANGES[bandIndex] && bands.length === BAND_RANGES.length ? BAND_RANGES[bandIndex] : FALLBACK_RANGE;
  const min = Math.floor(Math.min(bandMin, value || bandMin) / LAKH) * LAKH;
  const max = Math.ceil(Math.max(bandMax, value || bandMax) / LAKH) * LAKH;
  const sliderValue = value || Math.round((bandMin + bandMax) / 2 / 10000) * 10000;

  const set = (n) => onChange("exactPrice", n > 0 ? String(Math.round(n)) : "");
  const nudge = (delta) => set(Math.max(0, (value || sliderValue) + delta));

  const inBand = value && bandIndex >= 0 && bands.length === BAND_RANGES.length ? value >= bandMin && value <= bandMax : null;

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-4" style={{ "--accent": accent }}>
      {/* Top: small manual amount box */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink/55">Fix the exact price</p>
          <p className="text-[11px] text-ink/45 mt-0.5">Type an amount, or adjust live below</p>
        </div>
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Exact price in rupees</span>
          <span className="text-sm font-semibold text-ink/50">₹</span>
          <input
            className={`${adminInputCls} !w-36 !py-2 !px-3 text-sm text-right tabular-nums`}
            inputMode="numeric"
            placeholder="e.g. 65,00,000"
            value={value ? fmt(value) : ""}
            onChange={(e) => onChange("exactPrice", digits(e.target.value))}
          />
        </label>
      </div>

      {/* Live price */}
      <div className="relative mt-4 rounded-xl px-4 py-4 text-center" style={{ backgroundColor: `color-mix(in srgb, ${accent} 8%, white)` }}>
        <button
          type="button"
          onClick={() => set(0)}
          disabled={!value}
          aria-label="Clear exact price"
          title="Clear exact price"
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/80 hover:bg-white flex items-center justify-center disabled:opacity-0 transition"
        >
          <RotateCcw size={14} className="text-ink/60" />
        </button>
        <p className="font-display font-bold text-[2rem] leading-none tabular-nums transition-colors" style={{ color: value ? accent : "rgba(27,42,74,0.3)" }}>
          {value ? `₹${fmt(value)}` : "₹ —"}
        </p>
        <p className="text-[13px] font-semibold text-ink/60 mt-1.5 min-h-[1.25rem]">
          {value ? words(value) : "Not fixed yet. Move the slider to set it."}
        </p>
        {inBand !== null && (
          <p className={`text-[11px] font-semibold mt-1 ${inBand ? "text-[#1F7352]" : "text-coral"}`}>
            {inBand ? "Within the seller's range" : "Outside the seller's range"}
          </p>
        )}
      </div>

      {/* Slider */}
      <div className="mt-4 px-1">
        <input
          type="range"
          aria-label="Adjust exact price"
          min={min}
          max={max}
          step={10000}
          value={Math.min(Math.max(sliderValue, min), max)}
          onChange={(e) => set(Number(e.target.value))}
          className="w-full h-2 cursor-pointer"
          style={{ accentColor: accent }}
        />
        <div className="flex justify-between text-[10px] font-semibold text-ink/40 mt-1 tabular-nums">
          <span>₹{words(min)}</span>
          <span>₹{words(max)}</span>
        </div>
      </div>

      {/* Quick nudges: two even rows so they fit a phone screen */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[...STEPS].reverse().map((st) => (
          <button
            key={`m${st.label}`}
            type="button"
            onClick={() => nudge(-st.delta)}
            aria-label={`Decrease by ${st.label}`}
            className="h-10 rounded-full border border-ink/15 text-[13px] font-bold text-ink/70 hover:bg-ink/5 active:scale-95 transition flex items-center justify-center gap-1"
          >
            <Minus size={12} strokeWidth={3} />
            {st.label}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {STEPS.map((st) => (
          <button
            key={`p${st.label}`}
            type="button"
            onClick={() => nudge(st.delta)}
            aria-label={`Increase by ${st.label}`}
            className="h-10 rounded-full text-[13px] font-bold text-white active:scale-95 transition flex items-center justify-center gap-1"
            style={{ backgroundColor: accent }}
          >
            <Plus size={12} strokeWidth={3} />
            {st.label}
          </button>
        ))}
      </div>

      {/* Seller's own band, for context */}
      <div className="mt-4 pt-4 border-t border-ink/[0.07]">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink/55 mb-2">Seller's range</p>
        <div className="flex flex-wrap gap-2">
          {bands.map((b) => (
            <Chip key={b} active={expectedPrice === b} onClick={() => onChange("expectedPrice", expectedPrice === b ? "" : b)} className="!h-8 !text-[12px]">
              {b}
            </Chip>
          ))}
        </div>
        {expectedPrice && !bands.includes(expectedPrice) && (
          <p className="text-[11px] text-ink/50 mt-2">Seller entered: {expectedPrice}</p>
        )}
      </div>
    </div>
  );
}
