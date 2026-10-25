import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { MapPin, ArrowLeft, Heart, Share2, Check, Images, Phone, MessageCircle, ChevronRight, Send, CalendarCheck, Clock, Ruler } from "lucide-react";
import useProperties from "../lib/useProperties";
import useFavorites from "../lib/useFavorites";
import useRecent from "../lib/useRecent";
import { specsFor, highlightsFor, emiFrom, inr, listedAgo, similarTo } from "../lib/gallery";
import { optimizedImageUrl } from "../lib/cloudinary";
import { whatsappLink, callLink } from "../lib/whatsapp";
import { ADMIN_WHATSAPP_NUMBER } from "../lib/config";
import SoldOutStamp from "../components/SoldOutStamp";
import PhotoSlider from "../components/gallery/PhotoSlider";
import ImmersiveViewer from "../components/gallery/ImmersiveViewer";
import ImageLightbox from "../components/ImageLightbox";
import TopBar from "../components/gallery/TopBar";
import Highlights from "../components/gallery/Highlights";
import EmiCalculator from "../components/gallery/EmiCalculator";
import VisitSheet from "../components/gallery/VisitSheet";
import AboutProperty from "../components/gallery/AboutProperty";
import Burst from "../components/gallery/Burst";
import CollectionRail from "../components/gallery/CollectionRail";

const heroBtn =
  "relative pointer-events-auto w-10 h-10 rounded-full bg-ink-dark/55 text-white flex items-center justify-center hover:bg-ink-dark/75 transition-colors active:scale-95";
const GOLD_BTN = "bg-[#A8782A] hover:bg-[#946820] text-white";

function PageShell({ children }) {
  return <div className="min-h-screen bg-canvas flex flex-col">{children}</div>;
}

export default function PropertyDetail() {
  const { id } = useParams();
  const { properties, error } = useProperties();
  const favorites = useFavorites();
  const [photoIndex, setPhotoIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [shared, setShared] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [burst, setBurst] = useState(0);
  const recent = useRecent();
  const recordRecent = recent.record;
  const onIndex = useCallback((i) => setPhotoIndex(i), []);

  const listing = properties ? properties.find((p) => p.id === id) || null : undefined;
  const listingId = listing ? listing.id : null;
  useEffect(() => {
    if (listingId) recordRecent(listingId);
  }, [listingId, recordRecent]);

  if (error) {
    return (
      <PageShell>
        <TopBar title="Property" onBack={() => window.history.back()} />
        <div className="flex items-center justify-center px-5 py-16">
          <p className="alert-error max-w-sm">{error}</p>
        </div>
      </PageShell>
    );
  }

  if (listing === undefined) {
    return (
      <PageShell>
        <div className="max-w-3xl w-full mx-auto sm:px-4 sm:pt-4">
          <div className="aspect-[4/3.1] sm:aspect-[16/9] sm:rounded-3xl skeleton" />
          <div className="px-5 pt-6 space-y-3">
            <div className="h-7 w-2/3 rounded-md skeleton" />
            <div className="h-4 w-1/3 rounded-md skeleton" />
            <div className="h-6 w-1/4 rounded-md skeleton" />
            <div className="grid grid-cols-3 gap-2.5 pt-2">
              {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-2xl skeleton" />)}
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  if (listing === null) {
    return (
      <PageShell>
        <TopBar title="Property" onBack={() => window.history.back()} />
        <div className="flex flex-col items-center justify-center px-5 py-20 text-center gap-4">
          <h2 className="font-display font-bold text-2xl text-ink">This property isn't available anymore</h2>
          <p className="text-sm text-ink/60">It may have been sold or removed.</p>
          <Link to="/gallery" className="h-12 px-7 rounded-full bg-ink-dark text-white text-[12px] font-bold uppercase tracking-[0.12em] flex items-center justify-center">
            See all properties
          </Link>
        </div>
      </PageShell>
    );
  }

  const l = listing;
  const saved = favorites.has(l.id);
  const specs = specsFor(l);
  const attrEntries = Object.entries(l.attrs).filter(([, v]) => v);
  const heroImages = l.images.map((u) => optimizedImageUrl(u, 1200));
  const count = l.images.length;
  const highlights = highlightsFor(l);
  const emiMonthly = emiFrom(l);
  const ago = listedAgo(l);
  const similar = similarTo(l, properties);
  const enquiryText = `Hi, I'm interested in this property: ${l.title}${l.location ? ` (${l.location})` : ""}${l.price ? ` — ${l.price}` : ""}${l.refId ? `\n\nProperty ref: ${l.refId}` : ""}\n\nCan you share more details?`;

  // Share sheet on phones; copies the link everywhere else.
  async function handleShare() {
    const url = window.location.href;
    const text = `${l.title}${l.location ? `, ${l.location}` : ""}${l.price ? ` (${l.price})` : ""}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: l.title, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // cancelled or not allowed: nothing to do
    }
  }

  return (
    <PageShell>
      <div className="flex-1 max-w-3xl w-full mx-auto sm:px-4 sm:pt-4">
        <PhotoSlider
          images={heroImages}
          alt={l.title}
          onOpen={count ? setViewerIndex : undefined}
          onIndexChange={onIndex}
          className={`aspect-[4/3.1] sm:aspect-[16/9] sm:rounded-3xl ${l.sold ? "[&_img]:grayscale" : ""}`}
          overlayClass="bg-gradient-to-b from-ink-dark/50 via-transparent to-transparent"
        >
          <div className="absolute top-0 inset-x-0 flex items-start justify-between px-4" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
            <Link to="/gallery" aria-label="Back to all properties" className={heroBtn}>
              <ArrowLeft size={21} />
            </Link>
            <div className="flex gap-2">
              {!l.sold && (
                <button
                  type="button"
                  onClick={() => {
                    if (!saved) setBurst((n) => n + 1);
                    favorites.toggle(l.id);
                  }}
                  aria-pressed={saved}
                  aria-label={saved ? "Remove from saved" : "Save this property"}
                  className={`${heroBtn} ${saved ? "!bg-white !text-[#E5584A]" : ""}`}
                >
                  <Heart size={20} fill={saved ? "currentColor" : "none"} className={burst && saved ? "heart-beat" : ""} />
                  <Burst fire={burst} count={10} spread={40} />
                </button>
              )}
              <button type="button" onClick={handleShare} aria-label="Share this property" className={heroBtn}>
                {shared ? <Check size={20} /> : <Share2 size={20} />}
              </button>
            </div>
          </div>
          {count > 0 && (
            <Link
              to={`/gallery/${l.id}/photos`}
              aria-label={`See all ${count} photos`}
              className="pointer-events-auto absolute right-4 bottom-9 sm:bottom-5 flex items-center gap-1.5 rounded-xl bg-ink-dark/65 text-white text-[13px] font-bold px-3 py-1.5"
            >
              <Images size={15} />
              {photoIndex + 1}/{count}
            </Link>
          )}
          {l.floorPlan && (
            <button
              type="button"
              onClick={() => setPlanOpen(true)}
              aria-label="View floor plan"
              className="pointer-events-auto absolute left-4 bottom-9 sm:bottom-5 group w-[88px] rounded-xl overflow-hidden bg-white shadow-lg ring-2 ring-white/90 active:scale-95 transition-transform"
            >
              <img src={optimizedImageUrl(l.floorPlan, 240)} alt="" className="w-full h-[58px] object-contain bg-white p-0.5" loading="lazy" />
              <span className="flex items-center justify-center gap-1 bg-ink-dark/90 text-white text-[9px] font-bold uppercase tracking-wide py-1 whitespace-nowrap">
                <Ruler size={10} />
                Floor plan
              </span>
            </button>
          )}
          {l.sold && <SoldOutStamp size="lg" />}
        </PhotoSlider>

        <div className="relative z-10 -mt-6 sm:mt-0 rounded-t-[1.75rem] bg-canvas px-5 pt-6 pb-28">
          <h1 className="fade-up font-display font-bold text-[1.55rem] sm:text-3xl leading-tight text-ink">{l.title}</h1>
          {l.location && (
            <p className="fade-up mt-1.5 flex items-center gap-1.5 text-[14.5px] text-ink/60" style={{ "--d": "80ms" }}>
              <MapPin size={15} className="shrink-0 text-[#A8782A]" />
              {l.location}
            </p>
          )}
          <div className="fade-up mt-2 flex items-baseline flex-wrap gap-x-3 gap-y-1" style={{ "--d": "160ms" }}>
            <p className={`font-display font-bold ${l.price ? "text-[1.6rem]" : "text-[1.05rem] !font-semibold text-ink/50"} ${l.sold ? "text-ink/40 line-through" : l.price ? "text-ink" : ""}`}>
              {l.price || "Price on request"}
            </p>
            {l.pricePerSqft && !l.sold && <span className="text-[13px] font-semibold text-ink/55">{inr(l.pricePerSqft)} / sq.ft</span>}
          </div>
          {(emiMonthly > 0 || ago) && (
            <p className="fade-up mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink/55" style={{ "--d": "200ms" }}>
              {emiMonthly > 0 && <a href="#emi" className="font-semibold text-[#8A6218] underline underline-offset-2">EMI from {inr(emiMonthly)}/mo</a>}
              {ago && !l.sold && <span className="flex items-center gap-1"><Clock size={13} />{ago}</span>}
            </p>
          )}

          {highlights.length > 0 && <div className="mt-4"><Highlights items={highlights} /></div>}

          {specs.length > 0 && (
            <ul className="mt-4 grid gap-2.5" style={{ gridTemplateColumns: `repeat(${specs.length}, minmax(0, 1fr))` }}>
              {specs.map(({ icon: Icon, text }, i) => (
                <li
                  key={text}
                  className="fade-up rounded-2xl bg-surface ring-1 ring-ink/[0.07] py-3.5 px-2 flex flex-col items-center gap-2 text-center"
                  style={{ "--d": `${240 + i * 90}ms` }}
                >
                  <Icon size={22} strokeWidth={1.7} className="text-ink/60" />
                  <span className="text-[12.5px] font-semibold text-ink/80 leading-tight">{text}</span>
                </li>
              ))}
            </ul>
          )}

          <AboutProperty description={l.description} sellerNote={l.sellerNote} />

          {attrEntries.length > 0 && (
            <section className="mt-6">
              <h2 className="font-display font-bold text-[1.1rem] text-ink mb-2.5">Property details</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {attrEntries.map(([k, v]) => (
                  <div key={k} className="bg-surface ring-1 ring-ink/[0.07] rounded-xl px-3.5 py-3">
                    <p className="text-[10px] uppercase tracking-wider text-ink/50 font-bold leading-none mb-1.5">{k}</p>
                    <p className="text-sm text-ink/85 font-medium">{v}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!l.sold && l.priceNum >= 500000 && (
            <div id="emi" className="mt-7 scroll-mt-4"><EmiCalculator price={l.priceNum} /></div>
          )}

          <div className="mt-6 grid gap-2.5">
            {count > 0 && (
              <Link to={`/gallery/${l.id}/photos`} className="flex items-center gap-3 rounded-2xl bg-surface ring-1 ring-ink/[0.07] px-4 py-3.5 hover:ring-ink/20 transition">
                <Images size={20} className="text-[#A8782A]" />
                <span className="flex-1 text-[14.5px] font-semibold text-ink">All photos ({count})</span>
                <ChevronRight size={18} className="text-ink/40" />
              </Link>
            )}
            {l.location && (
              <Link to={`/gallery/${l.id}/photos?tab=location`} className="flex items-center gap-3 rounded-2xl bg-surface ring-1 ring-ink/[0.07] px-4 py-3.5 hover:ring-ink/20 transition">
                <MapPin size={20} className="text-[#A8782A]" />
                <span className="flex-1 text-[14.5px] font-semibold text-ink">Location &amp; map</span>
                <ChevronRight size={18} className="text-ink/40" />
              </Link>
            )}
            {!l.sold && (
              <Link to={`/gallery/${l.id}/enquiry`} className="flex items-center gap-3 rounded-2xl bg-surface ring-1 ring-ink/[0.07] px-4 py-3.5 hover:ring-ink/20 transition">
                <Send size={20} className="text-[#A8782A]" />
                <span className="flex-1 text-[14.5px] font-semibold text-ink">Send an enquiry</span>
                <ChevronRight size={18} className="text-ink/40" />
              </Link>
            )}
          </div>

          {similar.length >= 2 && (
            <CollectionRail eyebrow="You may also like" title="Similar properties" subtitle="Close in type, area and budget" items={similar} />
          )}
        </div>
      </div>

      {/* Pinned bar: the two actions that matter stay in reach */}
      <div className="sticky bottom-0 z-20 bg-surface border-t border-ink/10" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="max-w-3xl mx-auto px-4 py-3 grid grid-cols-[1fr_1.5fr_1fr] gap-2.5">
          {l.sold ? (
            <span className="col-span-3 h-14 rounded-2xl bg-ink/10 text-ink/45 text-[13px] font-bold uppercase tracking-[0.12em] flex items-center justify-center">
              No longer available
            </span>
          ) : (
            <>
              <a href={callLink(ADMIN_WHATSAPP_NUMBER)} className="rip h-14 rounded-2xl bg-ink-dark text-white font-semibold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform" aria-label="Call">
                <Phone size={19} />
                <span className="hidden min-[400px]:inline">Call</span>
              </a>
              <button type="button" onClick={() => setVisitOpen(true)} className={`rip btn-shine h-14 rounded-2xl ${GOLD_BTN} font-semibold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-[transform,background-color] shadow-[0_8px_20px_-8px_rgba(168,120,42,0.8)]`}>
                <CalendarCheck size={19} />
                Book a visit
              </button>
              <a
                href={whatsappLink(ADMIN_WHATSAPP_NUMBER, enquiryText)}
                target="_blank"
                rel="noreferrer"
                aria-label="WhatsApp"
                className="rip h-14 rounded-2xl bg-whatsapp text-white font-semibold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <MessageCircle size={19} />
                <span className="hidden min-[400px]:inline">Chat</span>
              </a>
            </>
          )}
        </div>
      </div>

      {visitOpen && <VisitSheet listing={l} onClose={() => setVisitOpen(false)} />}

      {planOpen && l.floorPlan && (
        <ImageLightbox images={[optimizedImageUrl(l.floorPlan, 1600)]} alt={`Floor plan of ${l.title}`} onClose={() => setPlanOpen(false)} />
      )}

      {viewerIndex !== null && (
        <ImmersiveViewer
          images={l.images}
          startIndex={viewerIndex}
          title={l.title}
          saved={saved}
          onToggleSaved={l.sold ? undefined : () => favorites.toggle(l.id)}
          onShare={handleShare}
          shared={shared}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </PageShell>
  );
}
