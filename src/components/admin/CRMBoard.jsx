import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clock, User, X, SlidersHorizontal, Camera, MapPin, Check, Search, Phone,
  MessageCircle, ChevronRight, Trash2, FileText, Link2, Share2, LayoutGrid, Columns3, Download, Ruler,
} from "lucide-react";
import Carousel from "../Carousel";
import SoldOutStamp from "../SoldOutStamp";
import { Sheet, Section, Chip, Field, TextInput, SelectInput, ManualSelect } from "./ui";
import PriceAdjustCard from "./PriceAdjustCard";
import { adminInputCls, btnDark, btnOutline, btnGreen, btnDanger } from "./styles";
import { adminUpdateLead, adminAddRemark, adminAddVisit, adminDeleteLead, addSellerLead, adminAddProperty, adminUpdateProperty } from "../../lib/api";
import { whatsappLink, callLink } from "../../lib/whatsapp";
import { downloadReport, downloadBrochure } from "../../lib/report";
import { uploadImage, optimizedImageUrl } from "../../lib/cloudinary";
import { leadScore, isOverdue as isRoleOverdue, parseDay } from "../../lib/insights";
import { ScoreBadge, WhatsAppMenu, CallButton } from "./insightUi";
import KanbanBoard from "./KanbanBoard";

// Each role has its own custom pipeline (set in AdminDashboard.jsx's
// CRM_CONFIG), so colours are assigned by position in that list rather than
// by matching specific status names — this works for any status list,
// including Mediator's second independent pipeline.
const STATUS_PALETTE = [
  { dot: "#C89B3C", text: "#8A6A1F" },
  { dot: "#3F7FB5", text: "#2D6291" },
  { dot: "#7A5BB0", text: "#6244A0" },
  { dot: "#2F8F6B", text: "#1F7352" },
  { dot: "#C4503F", text: "#B04336" },
  { dot: "#8A93A5", text: "#5B6475" },
];

function getStatusStyle(status, statuses) {
  const idx = statuses.indexOf(status);
  return STATUS_PALETTE[idx >= 0 ? idx % STATUS_PALETTE.length : STATUS_PALETTE.length - 1];
}

function StatusPill({ label, style }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: `color-mix(in srgb, ${style.dot} 14%, white)`, color: style.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: style.dot }} />
      {label}
    </span>
  );
}

// Free-text fields (no fixed options) that represent an amount/measurement
// large enough to benefit from comma formatting as the admin types.
const NUMERIC_AMOUNT_KEYS = new Set([
  "landArea", "builtUpArea", "frontageLength", "frontageBreadth", "exactPrice",
]);

// Formats a raw digit string with Indian-style thousands separators as the
// admin types (e.g. "10000" -> "10,000", "100000" -> "1,00,000") — matches
// the Lakhs/Crore convention already used throughout the app.
function formatThousands(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const last3 = digits.slice(-3);
  const other = digits.slice(0, -3);
  if (!other) return last3;
  const formattedOther = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${formattedOther},${last3}`;
}

// Strips formatting back down to a plain digit string for storage.
function unformatNumber(value) {
  return String(value ?? "").replace(/[^\d]/g, "");
}

// Detail fields where the admin can pick from the list OR type their own value.
const MANUAL_KEYS = new Set(["propertyAge", "pattaApproval", "rentalStatus"]);
// Shown in the live price card instead of the generic detail grid.
const PRICE_KEYS = new Set(["expectedPrice", "exactPrice"]);
// Internal custom-field keys: never shown as chips, attributes or report rows.
const HIDDEN_CUSTOM_KEYS = new Set(["galleryId", "soldOut", "floorPlan"]);

// Special keys that map to the Property record's dedicated columns.
// (Declared here, above its first use, rather than next to the modal.)
const GALLERY_SPECIAL_KEYS = { propertyType: "type", propertyStatus: "description", propertyLocation: "location" };

/**
 * Builds the buyer-safe listing from a lead's values. One function feeds both
 * the gallery publish and the customer PDF, from the detail sheet (live form
 * values) and from the card's quick PDF button (saved values), so they can
 * never disagree. Owner name, real phone and exact address are never included.
 */
function makeGalleryPayload({ values, fields, galleryFields, photos, customFields, refId }) {
  const isVisible = (key) => galleryFields.includes(key);
  const type = isVisible("propertyType") ? values.propertyType : "";
  const description = isVisible("propertyStatus") ? values.propertyStatus : "";
  const location = values.area || (isVisible("propertyLocation") ? values.propertyLocation : "");

  // Exact price (with proper Indian comma formatting) takes priority over the
  // admin-only budget figure, which takes priority over the seller's price band.
  const exactPriceDigits = unformatNumber(values.exactPrice);
  const price = exactPriceDigits
    ? `₹${formatThousands(exactPriceDigits)}`
    : values.budgetValue
    ? `₹${formatThousands(values.budgetValue)}`
    : values.expectedPrice || "";

  const attributeFields = fields.filter(
    ([key]) => !GALLERY_SPECIAL_KEYS[key] && !PRICE_KEYS.has(key) && key !== "sellerRemarks" && isVisible(key) && values[key]
  );
  const attributes = {
    ...Object.fromEntries(attributeFields.map(([key, label]) => [label, values[key]])),
    ...Object.fromEntries(Object.entries(customFields).filter(([k]) => !HIDDEN_CUSTOM_KEYS.has(k))),
  };
  // The floor plan rides inside the existing attributes JSON under a reserved
  // key (no new sheet column needed); the gallery pulls it back out again.
  if (customFields.floorPlan) attributes.__floorPlan = customFields.floorPlan;

  return {
    // A custom creative title wins if the admin has set one; otherwise
    // fall back to the auto-generated "Type in Area" style title.
    title: values.listingTitle?.trim() || `${type || "Property"} in ${location || "Chennai"}`,
    type,
    location,
    description,
    price,
    sqft: values.builtUpArea || values.landArea || values.sqft || "",
    images: JSON.stringify(photos),
    attributes: JSON.stringify(attributes),
    // Shown as its own styled callout on the gallery, not squeezed into the
    // small attribute grid — only included if toggled visible.
    sellerNote: isVisible("sellerRemarks") ? values.sellerRemarks || "" : "",
    refId,
  };
}

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatRemarkDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function parseRemarksLog(lead) {
  let log = [];
  if (lead.remarksLog) {
    try {
      const parsed = JSON.parse(lead.remarksLog);
      if (Array.isArray(parsed)) log = parsed;
    } catch {
      // ignore malformed JSON, fall back below
    }
  }
  if (log.length === 0 && lead.remarks) {
    log = [{ text: lead.remarks, at: lead.timestamp }];
  }
  return [...log].sort((a, b) => new Date(b.at) - new Date(a.at));
}

function parseCustomFields(lead) {
  if (!lead.customFields) return {};
  try {
    const parsed = JSON.parse(lead.customFields);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parsePhotos(lead) {
  if (!lead.photos) return [];
  try {
    const parsed = JSON.parse(lead.photos);
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 4) : [];
  } catch {
    return [];
  }
}

function parseVisitLog(lead) {
  if (!lead.visitLog) return [];
  try {
    const parsed = JSON.parse(lead.visitLog);
    if (!Array.isArray(parsed)) return [];
    return [...parsed].sort((a, b) => new Date(b.at) - new Date(a.at));
  } catch {
    return [];
  }
}

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location isn't available on this device/browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("Couldn't get your location — check location permission for this site.")),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

// Free reverse-geocoding via OpenStreetMap Nominatim. Non-commercial, low-
// volume use only — if this app grows, swap in a paid geocoding provider.
async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Reverse geocoding failed");
  const data = await res.json();
  return data.display_name || "";
}

function StarRating({ value, onChange, disabled, size = "text-lg" }) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <div className="flex items-center gap-0.5">
      {stars.map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled || !onChange}
          onClick={() => onChange && onChange(n === value ? 0 : n)}
          className={`${size} leading-none disabled:opacity-100`}
          style={{ color: n <= value ? "#C89B3C" : "#1B2A4A26" }}
          aria-label={`Set priority ${n}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ---------- Lead card ----------

// WhatsApp + Call buttons. A lead with no phone number (e.g. a field-visit lead)
// gets greyed-out buttons instead of a dead link.
function ContactButtons({ phone, name, compact = false }) {
  const has = Boolean(String(phone || "").trim());
  const h = compact ? "!h-10" : "";
  if (!has) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <span aria-disabled="true" className={`${btnGreen} ${h} opacity-40 pointer-events-none`}><MessageCircle size={14} /> WhatsApp</span>
        <span aria-disabled="true" className={`${btnOutline} ${h} opacity-40 pointer-events-none`}><Phone size={14} /> Call</span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <a href={whatsappLink(phone, `Hi ${name}, following up on your registration`)} target="_blank" rel="noreferrer" className={`${btnGreen} ${h}`}>
        <MessageCircle size={14} /> WhatsApp
      </a>
      <a href={callLink(phone)} className={`${btnOutline} ${h}`}>
        <Phone size={14} /> Call
      </a>
    </div>
  );
}

function LeadCard({ lead, role, adminName, accent, onOpen, statuses, statuses2, fields = [] }) {
  const [linkState, setLinkState] = useState("idle"); // idle | copied | missing
  const [pdfBusy, setPdfBusy] = useState(false);
  const status = lead.status || statuses[0];
  const priority = Number(lead.priority) || 0;
  const overdue = isRoleOverdue(role, lead);
  const score = leadScore(role, lead);
  const sStyle = getStatusStyle(status, statuses);
  const remarksLog = parseRemarksLog(lead);
  const customFields = parseCustomFields(lead);
  const latestRemark = remarksLog[0];
  const visitLog = parseVisitLog(lead);
  const latestVisit = visitLog[0];
  const rawPhotos = parsePhotos(lead).length ? parsePhotos(lead) : (latestVisit?.photoUrl ? [latestVisit.photoUrl] : []);
  const photos = rawPhotos.map((u) => optimizedImageUrl(u, 500));
  const soldOut = customFields.soldOut === "true";
  const tagChips = [
    lead.area && `📍 ${lead.area}`,
    lead.budgetValue && `₹ ${Number(lead.budgetValue).toLocaleString()}`,
    lead.sqft && `${Number(lead.sqft).toLocaleString()} sqft`,
    ...Object.entries(customFields).filter(([k]) => !HIDDEN_CUSTOM_KEYS.has(k)).map(([k, v]) => `${k}: ${v}`),
  ].filter(Boolean);
  const galleryId = customFields.galleryId;

  async function handleCopyLink() {
    if (!galleryId) {
      setLinkState("missing");
      setTimeout(() => setLinkState("idle"), 2200);
      return;
    }
    const url = `${window.location.origin}/gallery/${galleryId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
    }
    setLinkState("copied");
    setTimeout(() => setLinkState("idle"), 2000);
  }

  // Customer-safe PDF straight from the card, using the lead's saved details.
  async function handleDownloadPdf() {
    setPdfBusy(true);
    try {
      const galleryFields = parseGalleryFields(lead) || fields.filter(([key]) => lead[key]).map(([key]) => key);
      await downloadBrochure(
        makeGalleryPayload({ values: lead, fields, galleryFields, photos: rawPhotos, customFields, refId: lead.id })
      );
    } catch {
      window.alert("Couldn't create the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <article className="bg-surface rounded-2xl border border-ink/10 overflow-hidden flex flex-col">
      {photos.length > 0 && (
        <div className="relative h-40 shrink-0">
          <Carousel images={photos} alt={lead.name} showCounter />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/5 to-transparent pointer-events-none" />
          <div className="absolute bottom-2.5 left-3.5 right-3.5 text-white pointer-events-none">
            <p className="text-[11px] font-semibold flex items-center gap-1.5">
              <Camera size={12} />
              {latestVisit ? `Field visit · ${formatRemarkDateTime(latestVisit.at)}` : "Property photos"}
            </p>
            {latestVisit?.address && <p className="text-[10px] text-white/80 truncate">{latestVisit.address}</p>}
          </div>
          {soldOut && <SoldOutStamp size="sm" />}
        </div>
      )}

      <div className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-display font-bold text-[16px] leading-snug text-ink truncate flex items-center gap-2">
              {lead.name}
              {soldOut && photos.length === 0 && (
                <span className="text-[9px] font-bold uppercase tracking-wide bg-coral/15 text-coral px-1.5 py-0.5 rounded-full shrink-0">Sold out</span>
              )}
            </h3>
            <p className="text-[11px] text-ink/50 mt-0.5">#{lead.id} · {timeAgo(lead.timestamp)}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <StatusPill label={status} style={sStyle} />
            {statuses2 && lead.status2 && <StatusPill label={lead.status2} style={getStatusStyle(lead.status2, statuses2)} />}
          </div>
        </div>

        <p className="text-sm text-ink/75 flex items-center gap-1.5">
          <Phone size={13} className="text-ink/40" />
          {String(lead.phone || "").trim() ? lead.phone : <span className="text-ink/40 italic">No phone added yet</span>}
        </p>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5">
            <StarRating value={priority} />
            <ScoreBadge result={score} />
          </div>
          {lead.followUpDate && (
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${overdue ? "bg-coral/15 text-coral" : "bg-ink/5 text-ink/60"}`}>
              {overdue ? "Overdue · " : "Follow up "}
              {new Date(lead.followUpDate).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
            </span>
          )}
        </div>

        {tagChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tagChips.map((t) => (
              <span key={t} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-ink/5 text-ink/65">{t}</span>
            ))}
          </div>
        )}

        {latestRemark && (
          <div className="rounded-xl bg-[#F7F5F1] px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] text-ink/50 mb-0.5">
              <Clock size={10} strokeWidth={2.25} />
              {formatRemarkDateTime(latestRemark.at)}
              {latestRemark.by && <span className="font-semibold" style={{ color: accent }}>· {latestRemark.by}</span>}
            </div>
            <p className="text-[13px] text-ink/75 leading-snug line-clamp-2">{latestRemark.text}</p>
          </div>
        )}

        <div className="mt-auto pt-1 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <WhatsAppMenu role={role} lead={lead} adminName={adminName} compact />
            <CallButton phone={lead.phone} compact />
          </div>
          {role === "seller" && (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleCopyLink}
                className={`${btnOutline} !h-10 !px-2 !text-[11px] ${linkState === "missing" ? "!text-coral !border-coral/40" : ""}`}
                title={galleryId ? "Copy the buyer-facing property link" : "Share this property on the gallery first (open details)"}
              >
                {linkState === "copied" ? <Check size={13} strokeWidth={3} /> : <Link2 size={13} />}
                {linkState === "copied" ? "Link copied" : linkState === "missing" ? "Share first" : "Copy link"}
              </button>
              <button onClick={handleDownloadPdf} disabled={pdfBusy} className={`${btnOutline} !h-10 !px-2 !text-[11px]`} title="Customer-safe PDF to share with a buyer">
                <Download size={13} />
                {pdfBusy ? "Preparing…" : "Download PDF"}
              </button>
            </div>
          )}
          <button onClick={onOpen} className={`${btnDark} w-full`}>
            Open details
            {remarksLog.length > 0 && <span className="opacity-70 normal-case tracking-normal font-semibold">· {remarksLog.length} remark{remarksLog.length === 1 ? "" : "s"}</span>}
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

// ---------- Full detail / edit modal ----------

// Every field shown in "Submitted details" is individually toggleable for
// the gallery — admin decides field by field. propertyType, propertyStatus,
// and propertyLocation get special handling (they map to the Property
// record's dedicated type/description/location columns) but are still
// fully toggleable like everything else. Owner name, real phone, and exact
// address are never part of this list — they're never sent regardless.
function parseGalleryFields(lead) {
  if (!lead.galleryFields) return null;
  try {
    const parsed = JSON.parse(lead.galleryFields);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function LeadDetailModal({ lead, fields, accent, sheet, roleLabel, statuses, statuses2, status2Label, onClose, onSaveDetails, onAddRemark, onShareGallery, onDeleteLead }) {
  const [form, setForm] = useState(() => ({
    name: lead.name || "",
    phone: lead.phone || "",
    status: lead.status || statuses[0],
    status2: lead.status2 || "",
    priority: Number(lead.priority) || 0,
    followUpDate: lead.followUpDate || "",
    area: lead.area || "",
    budgetValue: lead.budgetValue || "",
    listingTitle: lead.listingTitle || "",
    sqft: lead.sqft || "",
    exactAddress: lead.exactAddress || "",
    mapLink: lead.mapLink || "",
    ...Object.fromEntries(fields.map(([k]) => [k, lead[k] ?? ""])),
  }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [newRemark, setNewRemark] = useState("");
  const [savingRemark, setSavingRemark] = useState(false);
  const [remarkError, setRemarkError] = useState("");
  const [customFields, setCustomFields] = useState(() => parseCustomFields(lead));
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldValue, setNewFieldValue] = useState("");
  const [photos, setPhotos] = useState(() => parsePhotos(lead));
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [floorPlanUploading, setFloorPlanUploading] = useState(false);
  const [floorPlanError, setFloorPlanError] = useState("");
  const [galleryStatus, setGalleryStatus] = useState("idle"); // idle | sharing | shared
  const [galleryError, setGalleryError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [soldOut, setSoldOut] = useState(() => parseCustomFields(lead).soldOut === "true");
  const [galleryFields, setGalleryFields] = useState(() => {
    const saved = parseGalleryFields(lead);
    if (saved) return saved;
    // No saved preference yet — default to showing every toggleable field
    // that actually has a value, so admin only needs to opt OUT of ones
    // they want to hide, not opt everything in from scratch.
    return fields.filter(([key]) => lead[key]).map(([key]) => key);
  });

  function toggleGalleryField(key) {
    setGalleryFields((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const remarksLog = useMemo(() => parseRemarksLog(lead), [lead]);
  const supportsPhoto = sheet === "Sellers";

  async function persistPhotos(next) {
    setPhotos(next);
    await onSaveDetails(lead.id, { photos: JSON.stringify(next) });
  }

  async function handleAddPhotoSlot(e) {
    const file = e.target.files?.[0];
    if (!file || photos.length >= 4) return;
    setPhotoError("");
    setPhotoUploading(true);
    try {
      const url = await uploadImage(file);
      await persistPhotos([...photos, url]);
    } catch (err) {
      setPhotoError(err.message || "Couldn't upload that photo.");
    } finally {
      setPhotoUploading(false);
      e.target.value = "";
    }
  }

  async function handleRemovePhoto(index) {
    setPhotoError("");
    try {
      await persistPhotos(photos.filter((_, i) => i !== index));
    } catch (err) {
      setPhotoError(err.message || "Couldn't remove that photo.");
    }
  }

  // Floor plan / sketch (apartments): stored in the lead's customFields and
  // saved straight away, like photos.
  async function persistFloorPlan(url) {
    const next = { ...customFields };
    if (url) next.floorPlan = url;
    else delete next.floorPlan;
    setCustomFields(next);
    await onSaveDetails(lead.id, { customFields: JSON.stringify(next) });
  }

  async function handleFloorPlanFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFloorPlanError("");
    setFloorPlanUploading(true);
    try {
      await persistFloorPlan(await uploadImage(file));
    } catch (err) {
      setFloorPlanError(err.message || "Couldn't upload the floor plan.");
    } finally {
      setFloorPlanUploading(false);
      e.target.value = "";
    }
  }

  async function handleRemoveFloorPlan() {
    setFloorPlanError("");
    try {
      await persistFloorPlan("");
    } catch (err) {
      setFloorPlanError(err.message || "Couldn't remove the floor plan.");
    }
  }

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function updateCustomField(key, value) {
    setCustomFields((cf) => ({ ...cf, [key]: value }));
    setSaved(false);
  }

  function removeCustomField(key) {
    setCustomFields((cf) => {
      const next = { ...cf };
      delete next[key];
      return next;
    });
    setSaved(false);
  }

  function addCustomField() {
    const name = newFieldName.trim();
    if (!name) return;
    setCustomFields((cf) => ({ ...cf, [name]: newFieldValue.trim() }));
    setNewFieldName("");
    setNewFieldValue("");
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      await onSaveDetails(lead.id, { ...form, customFields: JSON.stringify(customFields) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err.message || "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  function handleDownloadSingle() {
    downloadReport({
      roleLabel: roleLabel || "Lead",
      accent,
      fields,
      leads: [lead],
      filterLabel: lead.name || lead.id,
      statuses,
    });
  }

  // Buyer-safe PDF for sharing directly with a customer — reuses the same
  // Buyer-safe payload, respecting the per-field visibility checklist.
  function buildGalleryPayload() {
    return makeGalleryPayload({ values: form, fields, galleryFields, photos, customFields, refId: lead.id });
  }

  // Buyer-safe PDF for sharing directly with a customer — reuses the same
  // privacy rules as "Share on gallery" (respects the field-visibility
  // checklist), but doesn't require actually publishing to the gallery.
  // Owner name, real phone, and exact address never appear; the mediator's
  // own number shows as the contact.
  function handleDownloadCustomerPDF() {
    downloadBrochure(buildGalleryPayload());
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    setDeleting(true);
    setDeleteError("");
    try {
      await onDeleteLead(lead.id);
      onClose();
    } catch (err) {
      setDeleteError(err.message || "Couldn't delete this lead.");
      setDeleting(false);
    }
  }

  async function handleCopyLink() {
    if (!customFields.galleryId) return;
    const url = `${window.location.origin}/gallery/${customFields.galleryId}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  async function handleShareGallery() {
    setGalleryError("");
    setGalleryStatus("sharing");
    try {
      const payload = {
        ...buildGalleryPayload(),
        imageUrl: photos[0] || "",
        // Deliberately blank — the buyer gallery never shows the owner's number.
        contactPhone: "",
        soldOut: soldOut ? "true" : "false",
      };
      const newId = await onShareGallery(customFields.galleryId, payload);
      const nextCustomFields = { ...customFields, galleryId: newId, soldOut: soldOut ? "true" : "false" };
      setCustomFields(nextCustomFields);
      await onSaveDetails(lead.id, {
        ...form,
        customFields: JSON.stringify(nextCustomFields),
        galleryFields: JSON.stringify(galleryFields),
      });
      setGalleryStatus("shared");
      setTimeout(() => setGalleryStatus("idle"), 2500);
    } catch (err) {
      setGalleryError(err.message || "Couldn't share this to the gallery.");
      setGalleryStatus("idle");
    }
  }

  async function handleAddRemark() {
    if (!newRemark.trim()) return;
    setSavingRemark(true);
    setRemarkError("");
    try {
      await onAddRemark(lead.id, newRemark.trim());
      setNewRemark("");
    } catch (err) {
      setRemarkError(err.message || "Couldn't save that remark.");
    } finally {
      setSavingRemark(false);
    }
  }

  const customKeys = Object.keys(customFields).filter((k) => !HIDDEN_CUSTOM_KEYS.has(k));
  const hasPriceCard = supportsPhoto && fields.some(([key]) => key === "exactPrice");
  const detailFields = fields.filter(([key]) => key !== "sellerRemarks" && !(hasPriceCard && PRICE_KEYS.has(key)));
  const toggleable = detailFields.filter(([key]) => form[key]);
  const sellerRemarkOn = galleryFields.includes("sellerRemarks");

  return (
    <Sheet
      title={form.name || "Lead"}
      subtitle={`#${lead.id} · ${roleLabel} lead`}
      accent={accent}
      onClose={onClose}
      footer={
        <>
          {saveError && <p className="text-xs text-coral mb-2">{saveError}</p>}
          {deleteError && <p className="text-xs text-coral mb-2">{deleteError}</p>}
          <button onClick={handleSave} disabled={saving} className={`${btnDark} w-full !h-12`}>
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
          </button>
          <div className="flex gap-2 mt-2.5">
            <button onClick={handleDownloadSingle} className={`${btnOutline} flex-1 !px-2 !h-10 !text-[11px]`} title="Full internal PDF — includes owner name, phone, and exact address">
              <FileText size={13} /> Admin PDF
            </button>
            {supportsPhoto && (
              <button onClick={handleDownloadCustomerPDF} className={`${btnOutline} flex-1 !px-2 !h-10 !text-[11px]`} title="Buyer-safe PDF to share with a customer — no owner name, phone, or exact address">
                <FileText size={13} /> Customer PDF
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={`${confirmDelete ? btnDanger : `${btnOutline} !text-coral !border-coral/40`} flex-1 !px-2 !h-10 !text-[11px]`}
            >
              <Trash2 size={13} />
              {deleting ? "Deleting…" : confirmDelete ? "Tap to confirm" : "Delete"}
            </button>
          </div>
        </>
      }
    >
      {/* One-tap contact */}
      <div className="mb-4">
        <ContactButtons phone={form.phone} name={form.name} />
      </div>

      <Section title="Contact & pipeline" defaultOpen>
        <div className="grid sm:grid-cols-2 gap-3.5">
          <TextInput label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <TextInput label="Phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          <SelectInput label="Status" options={statuses} value={form.status} onChange={(e) => set("status", e.target.value)} />
          <TextInput label="Next follow-up" type="date" value={form.followUpDate} onChange={(e) => set("followUpDate", e.target.value)} />
          {statuses2 && (
            <SelectInput
              label={status2Label || "Second pipeline"}
              emptyLabel="— not set —"
              options={statuses2}
              value={form.status2}
              onChange={(e) => set("status2", e.target.value)}
            />
          )}
          <Field label="Priority">
            <StarRating value={form.priority} onChange={(v) => set("priority", v)} size="text-3xl" />
          </Field>
        </div>
      </Section>

      <Section title="Remarks" badge={remarksLog.length || null} defaultOpen>
        <p className="text-xs text-ink/50 mb-3">Your own internal notes. They are never shown on the gallery.</p>
        {remarksLog.length === 0 ? (
          <p className="text-sm text-ink/45 italic mb-3">No remarks yet. Add the first one below.</p>
        ) : (
          <div className="max-h-52 overflow-y-auto space-y-2 mb-3">
            {remarksLog.map((r, i) => (
              <div key={i} className="border-l-[3px] rounded-lg bg-[#F7F5F1] px-3 py-2.5" style={{ borderLeftColor: accent }}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink/50 mb-1">
                  <span className="inline-flex items-center gap-1">
                    <Clock size={11} strokeWidth={2.25} />
                    {formatRemarkDateTime(r.at)}
                  </span>
                  {r.by && (
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: accent }}>
                      <User size={11} strokeWidth={2.25} />
                      {r.by}
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink/85 leading-snug whitespace-pre-line">{r.text}</p>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            className={`${adminInputCls} flex-1 min-w-0`}
            placeholder="Add a remark…"
            aria-label="New remark"
            value={newRemark}
            onChange={(e) => setNewRemark(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddRemark()}
          />
          <button onClick={handleAddRemark} disabled={savingRemark || !newRemark.trim()} className={`${btnGreen} !px-5 shrink-0`}>
            {savingRemark ? "…" : "Add"}
          </button>
        </div>
        {remarkError && <p className="text-xs text-coral mt-2">{remarkError}</p>}
      </Section>

      {supportsPhoto && (
        <Section title="Property photos" badge={`${photos.length}/4`} defaultOpen={photos.length > 0}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {photos.map((url, i) => (
              <div key={url + i} className="relative rounded-xl overflow-hidden aspect-square bg-ink/5">
                <img src={optimizedImageUrl(url, 300)} alt={`Property ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                {i === 0 && (
                  <span className="absolute top-1.5 left-1.5 text-[9px] font-bold uppercase tracking-wide bg-ink/80 text-white px-1.5 py-0.5 rounded">Cover</span>
                )}
                <button
                  type="button"
                  onClick={() => handleRemovePhoto(i)}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute top-1.5 right-1.5 w-8 h-8 rounded-full bg-ink/75 text-white flex items-center justify-center"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {photos.length < 4 && (
              <label className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-ink/20 aspect-square cursor-pointer hover:border-ink/40 hover:bg-ink/[0.02] transition">
                <Camera size={20} className="text-ink/40" strokeWidth={1.5} />
                <span className="text-[11px] font-semibold text-ink/55 text-center px-2">{photoUploading ? "Uploading…" : "Add photo"}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleAddPhotoSlot} disabled={photoUploading} />
              </label>
            )}
          </div>
          {photoError && <p className="text-xs text-coral mt-2">{photoError}</p>}
        </Section>
      )}

      {hasPriceCard && (
        <Section title="Expected price" badge={form.exactPrice ? `₹${formatThousands(form.exactPrice)}` : null} defaultOpen>
          <PriceAdjustCard
            bands={fields.find(([key]) => key === "expectedPrice")?.[2] || []}
            expectedPrice={form.expectedPrice}
            exactPrice={form.exactPrice}
            accent={accent}
            onChange={set}
          />
        </Section>
      )}

      {supportsPhoto && (
        <Section title="Floor plan / sketch" badge={customFields.floorPlan ? "Added" : null} defaultOpen={!!customFields.floorPlan}>
          <p className="text-xs text-ink/50 mb-3">
            Upload the sketch for an apartment or house. It appears in the corner of the property photo for buyers, and on the customer PDF.
            {customFields.galleryId && " Tap “Update on gallery” below to show a new sketch on the live page."}
          </p>
          {customFields.floorPlan ? (
            <div className="rounded-xl border border-ink/10 bg-white p-2">
              <img src={optimizedImageUrl(customFields.floorPlan, 900)} alt="Floor plan" className="w-full max-h-64 object-contain rounded-lg" loading="lazy" />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <label className={`${btnOutline} !h-10 !text-[11px] cursor-pointer`}>
                  <Ruler size={13} />
                  {floorPlanUploading ? "Uploading…" : "Replace"}
                  <input type="file" accept="image/*" className="hidden" onChange={handleFloorPlanFile} disabled={floorPlanUploading} />
                </label>
                <button type="button" onClick={handleRemoveFloorPlan} className={`${btnOutline} !h-10 !text-[11px] !text-coral !border-coral/40`}>
                  <Trash2 size={13} /> Remove
                </button>
              </div>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-ink/20 py-7 cursor-pointer hover:border-ink/40 hover:bg-ink/[0.02] transition">
              <Ruler size={22} className="text-ink/40" strokeWidth={1.5} />
              <span className="text-[12px] font-semibold text-ink/55">{floorPlanUploading ? "Uploading…" : "Add floor plan / sketch"}</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleFloorPlanFile} disabled={floorPlanUploading} />
            </label>
          )}
          {floorPlanError && <p className="text-xs text-coral mt-2">{floorPlanError}</p>}
        </Section>
      )}

      <Section title="Submitted details">
        <div className="grid sm:grid-cols-2 gap-3.5">
          {detailFields.map(([key, label, options]) =>
            options && MANUAL_KEYS.has(key) ? (
              <ManualSelect key={key} label={label} options={options} value={form[key]} onChange={(v) => set(key, v)} />
            ) : options ? (
              <SelectInput key={key} label={label} emptyLabel="— not set —" options={options} value={form[key]} onChange={(e) => set(key, e.target.value)} />
            ) : NUMERIC_AMOUNT_KEYS.has(key) ? (
              <TextInput
                key={key}
                label={label}
                inputMode="numeric"
                placeholder="e.g. 10,000"
                value={formatThousands(form[key])}
                onChange={(e) => set(key, unformatNumber(e.target.value))}
              />
            ) : (
              <TextInput key={key} label={label} value={form[key]} onChange={(e) => set(key, e.target.value)} />
            )
          )}
        </div>
      </Section>

      <Section title="Area & size (used by filters)">
        <div className="grid sm:grid-cols-3 gap-3.5">
          <TextInput label="Area / locality" placeholder="e.g. Ambattur" value={form.area} onChange={(e) => set("area", e.target.value)} />
          <TextInput
            label="Budget (₹)"
            inputMode="numeric"
            placeholder="e.g. 50,00,000"
            value={formatThousands(form.budgetValue)}
            onChange={(e) => set("budgetValue", unformatNumber(e.target.value))}
          />
          <TextInput label="Size (sqft)" type="number" inputMode="decimal" placeholder="e.g. 1200" value={form.sqft} onChange={(e) => set("sqft", e.target.value)} />
        </div>
      </Section>

      {supportsPhoto && (
        <Section title="Exact location">
          <div className="grid gap-3.5">
            <Field label="Exact address">
              {(id) => (
                <textarea id={id} className={`${adminInputCls} min-h-[72px]`} placeholder="Type or paste the full address" value={form.exactAddress} onChange={(e) => set("exactAddress", e.target.value)} />
              )}
            </Field>
            <TextInput
              label="Google Maps link"
              placeholder="Paste a Google Maps link here"
              hint="Open the place in Google Maps, tap Share, copy the link and paste it here."
              value={form.mapLink}
              onChange={(e) => set("mapLink", e.target.value)}
            />
          </div>
        </Section>
      )}

      <Section title="Custom fields" badge={customKeys.length || null}>
        <p className="text-xs text-ink/50 mb-3">
          Add any detail you need, like "Facing" or "Furnishing". It becomes a filter option across all leads.
        </p>
        {customKeys.length > 0 && (
          <div className="space-y-2 mb-3">
            {customKeys.map((key) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink/65 w-24 shrink-0 truncate">{key}</span>
                <input className={`${adminInputCls} flex-1 min-w-0 !py-2.5`} aria-label={key} value={customFields[key]} onChange={(e) => updateCustomField(key, e.target.value)} />
                <button type="button" onClick={() => removeCustomField(key)} aria-label={`Remove ${key}`} className="shrink-0 w-10 h-10 rounded-full bg-ink/5 hover:bg-coral/10 flex items-center justify-center">
                  <X size={15} className="text-ink/55" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <input className={adminInputCls} placeholder="Name (e.g. Facing)" aria-label="New field name" value={newFieldName} onChange={(e) => setNewFieldName(e.target.value)} />
          <input
            className={adminInputCls}
            placeholder="Value (e.g. East)"
            aria-label="New field value"
            value={newFieldValue}
            onChange={(e) => setNewFieldValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustomField()}
          />
        </div>
        <button onClick={addCustomField} disabled={!newFieldName.trim()} className={`${btnOutline} w-full mt-2`}>
          + Add field
        </button>
      </Section>

      {supportsPhoto && (
        <Section title="Buyer gallery" badge={customFields.galleryId ? "Live" : null}>
          <p className="text-xs text-ink/50 mb-4">
            Publishes a buyer-safe version of this listing. The owner's name, phone number and exact address are never included.
          </p>

          <TextInput
            label="Listing title"
            placeholder="e.g. Sun-drenched 3BHK with a private terrace garden"
            hint="Optional. Leave blank to use the plain “Type in Area” title."
            value={form.listingTitle}
            onChange={(e) => set("listingTitle", e.target.value)}
          />

          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink/55">Seller's remark</span>
              <Chip active={sellerRemarkOn} onClick={() => toggleGalleryField("sellerRemarks")} className="!h-8 !text-[12px]">
                {sellerRemarkOn && <Check size={12} strokeWidth={3} />}
                Show on gallery
              </Chip>
            </div>
            <textarea
              className={`${adminInputCls} min-h-[72px]`}
              aria-label="Seller's remark"
              placeholder="What the seller told you. This is separate from your internal remarks."
              value={form.sellerRemarks}
              onChange={(e) => set("sellerRemarks", e.target.value)}
            />
          </div>

          {toggleable.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink/55 mb-2">Details to show on the gallery</p>
              <div className="flex flex-wrap gap-2">
                {toggleable.map(([key, label]) => {
                  const on = galleryFields.includes(key);
                  return (
                    <Chip key={key} active={on} onClick={() => toggleGalleryField(key)}>
                      {on && <Check size={12} strokeWidth={3} />}
                      {label}
                    </Chip>
                  );
                })}
              </div>
            </div>
          )}

          <label className="mt-4 flex items-center gap-3 rounded-xl border border-ink/10 bg-[#F7F5F1] px-4 py-3 cursor-pointer select-none">
            <input type="checkbox" checked={soldOut} onChange={(e) => setSoldOut(e.target.checked)} className="w-5 h-5 accent-[#B94A3D]" />
            <span className="text-sm font-semibold text-ink/80 flex-1">Mark as sold out</span>
            {soldOut && <span className="text-[10px] font-bold uppercase tracking-wide bg-coral/15 text-coral px-2 py-0.5 rounded-full">Sold out</span>}
          </label>

          <button onClick={handleShareGallery} disabled={galleryStatus === "sharing"} className={`${btnDark} w-full mt-4 !h-12`}>
            <Share2 size={15} />
            {galleryStatus === "sharing" && "Sharing…"}
            {galleryStatus === "shared" && "Shared ✓"}
            {galleryStatus === "idle" && (customFields.galleryId ? "Update on gallery" : "Share on gallery")}
          </button>
          {customFields.galleryId && (
            <button onClick={handleCopyLink} className={`${btnOutline} w-full mt-2`}>
              <Link2 size={15} />
              {linkCopied ? "Link copied ✓" : "Copy property link"}
            </button>
          )}
          {galleryError && <p className="text-xs text-coral mt-2">{galleryError}</p>}
        </Section>
      )}
    </Sheet>
  );
}

// ---------- New field-visit lead (standalone — creates a brand new seller lead) ----------

function NewFieldVisitModal({ accent, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [coords, setCoords] = useState(null); // { lat, lng }
  const [address, setAddress] = useState("");
  const [locating, setLocating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState("");

  function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    setError("");
  }

  async function handleCaptureLocation() {
    setLocating(true);
    setError("");
    try {
      const loc = await getCurrentLocation();
      setCoords(loc);
      try {
        const auto = await reverseGeocode(loc.lat, loc.lng);
        if (auto) setAddress(auto);
      } catch {
        // reverse geocoding failed — coords are still captured, admin can type the address manually
      }
    } catch (err) {
      setError(err.message || "Couldn't get your location.");
    } finally {
      setLocating(false);
    }
  }

  async function handleCreate() {
    if (!photo) {
      setError("Take a photo first.");
      return;
    }
    if (!address.trim() && !coords) {
      setError("Capture your live location or type the address manually.");
      return;
    }
    setError("");
    setCreating(true);
    setUploadPct(0);
    try {
      const photoUrl = await uploadImage(photo, setUploadPct);
      await onCreate({
        name: name.trim() || "Field visit lead",
        phone: phone.trim(),
        photoUrl,
        lat: coords?.lat || "",
        lng: coords?.lng || "",
        address: address.trim(),
      });
    } catch (err) {
      setError(err.message || "Couldn't create this lead.");
      setCreating(false);
    }
  }

  return (
    <Sheet
      title="New field visit"
      subtitle="Creates a new seller lead, timestamped now"
      accent={accent}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <>
          {error && <p className="text-xs text-coral mb-2">{error}</p>}
          <button onClick={handleCreate} disabled={!photo || creating} className={`${btnDark} w-full !h-12`}>
            {creating ? (uploadPct > 0 && uploadPct < 100 ? `Uploading photo… ${uploadPct}%` : "Creating lead…") : "Create lead from this visit"}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink/60 leading-relaxed mb-5">
        Take a photo on site, capture your live location (or type the address), and fill in the rest later from the lead's details.
      </p>

      <div className="grid grid-cols-2 gap-3.5">
        <TextInput label="Name (optional)" placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextInput label="Phone (optional)" type="tel" inputMode="tel" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>

      <div className="mt-5 flex items-center gap-3">
        <label className={`${btnOutline} cursor-pointer shrink-0`}>
          <Camera size={15} strokeWidth={2.25} />
          {photo ? "Retake photo" : "Take photo"}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoChange} />
        </label>
        {photoPreview && <img src={photoPreview} alt="Preview" className="w-14 h-14 rounded-xl object-cover" />}
      </div>

      <div className="mt-5">
        <button onClick={handleCaptureLocation} disabled={locating} className={`${btnOutline} w-full`}>
          <MapPin size={15} strokeWidth={2.25} />
          {locating ? "Getting live location…" : coords ? "Re-capture live location" : "Capture live location"}
        </button>
        {coords && (
          <p className="text-[11px] text-ink/50 mt-2">
            Captured: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </p>
        )}
        <div className="mt-3">
          <TextInput label="Address" placeholder="Auto-filled after capture, or type it" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
      </div>
    </Sheet>
  );
}

// ---------- Filters (opens as a sheet) ----------

function FiltersSheet({ accent, resultCount, areas, selectedAreas, onToggleArea, budgetMin, budgetMax, setBudgetMin, setBudgetMax, sqftMin, sqftMax, setSqftMin, setSqftMax, facets, selectedFacets, onToggleFacetValue, onClear, onClose }) {
  const facetNames = Object.keys(facets);
  return (
    <Sheet
      title="Filters"
      subtitle={`${resultCount} lead${resultCount === 1 ? "" : "s"} match`}
      accent={accent}
      onClose={onClose}
      maxWidth="max-w-xl"
      footer={
        <div className="flex gap-2.5">
          <button onClick={onClear} className={`${btnOutline} flex-1`}>Clear all</button>
          <button onClick={onClose} className={`${btnDark} flex-1`}>Show {resultCount}</button>
        </div>
      }
    >
      {areas.length > 0 && (
        <div className="mb-6">
          <p className="font-display font-bold text-[15px] text-ink mb-2.5">Area</p>
          <div className="flex flex-wrap gap-2">
            {areas.map((a) => (
              <Chip key={a} active={selectedAreas.includes(a)} onClick={() => onToggleArea(a)}>{a}</Chip>
            ))}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-5 mb-6">
        <div>
          <p className="font-display font-bold text-[15px] text-ink mb-2.5">Budget (₹)</p>
          <div className="flex items-center gap-2">
            <input type="number" inputMode="numeric" placeholder="Min" aria-label="Minimum budget" className={adminInputCls} value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} />
            <span className="text-ink/30">–</span>
            <input type="number" inputMode="numeric" placeholder="Max" aria-label="Maximum budget" className={adminInputCls} value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} />
          </div>
        </div>
        <div>
          <p className="font-display font-bold text-[15px] text-ink mb-2.5">Size (sqft)</p>
          <div className="flex items-center gap-2">
            <input type="number" inputMode="numeric" placeholder="Min" aria-label="Minimum size" className={adminInputCls} value={sqftMin} onChange={(e) => setSqftMin(e.target.value)} />
            <span className="text-ink/30">–</span>
            <input type="number" inputMode="numeric" placeholder="Max" aria-label="Maximum size" className={adminInputCls} value={sqftMax} onChange={(e) => setSqftMax(e.target.value)} />
          </div>
        </div>
      </div>

      {facetNames.map((name) => (
        <div key={name} className="mb-6 last:mb-0">
          <p className="font-display font-bold text-[15px] text-ink mb-2.5">{name}</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(facets[name]).map(([value, count]) => (
              <Chip key={value} active={(selectedFacets[name] || []).includes(value)} onClick={() => onToggleFacetValue(name, value)}>
                {value} <span className="opacity-60">({count})</span>
              </Chip>
            ))}
          </div>
        </div>
      ))}
    </Sheet>
  );
}

// ---------- Main board ----------

export default function CRMBoard({ type, label, accent, sheet, fetcher, fields, facetFields = [], statuses, statuses2, status2Label, password, adminName, initialOpenId = null, onOpenHandled }) {
  const [leads, setLeads] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [activeStatus, setActiveStatus] = useState("All");
  const [activeStatus2, setActiveStatus2] = useState("All");
  const [openLeadId, setOpenLeadId] = useState(initialOpenId);
  const [view, setView] = useState(() => {
    try { return localStorage.getItem("mcm_crm_view") === "board" ? "board" : "list"; } catch { return "list"; }
  });
  const [moveError, setMoveError] = useState("");
  const [showNewVisit, setShowNewVisit] = useState(false);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedAreas, setSelectedAreas] = useState([]);
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [sqftMin, setSqftMin] = useState("");
  const [sqftMax, setSqftMax] = useState("");
  const [selectedFacets, setSelectedFacets] = useState({});
  const [sortBy, setSortBy] = useState("newest");

  function load() {
    fetcher(password)
      .then((data) => setLeads([...data].reverse()))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    setLeads(null);
    setError("");
    setOpenLeadId(initialOpenId);
    setActiveStatus("All");
    setActiveStatus2("All");
    setSelectedAreas([]);
    setBudgetMin(""); setBudgetMax(""); setSqftMin(""); setSqftMax("");
    setSelectedFacets({});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // The command palette / Overview can ask for a specific lead to be opened.
  useEffect(() => {
    if (initialOpenId) setOpenLeadId(initialOpenId);
  }, [initialOpenId]);

  function chooseView(v) {
    setView(v);
    try { localStorage.setItem("mcm_crm_view", v); } catch { /* storage may be unavailable */ }
  }

  // Optimistic: the card jumps columns instantly, and snaps back with a
  // message if the sheet rejects the change.
  async function moveLead(id, status) {
    const before = leads;
    setMoveError("");
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    try {
      await adminUpdateLead(password, sheet, id, { status });
    } catch (err) {
      setLeads(before);
      setMoveError(err.message || "Couldn't move that lead — it has been put back.");
    }
  }

  const onChanged = {
    updateMeta: async (id, patch) => {
      await adminUpdateLead(password, sheet, id, patch);
      load();
    },
    addRemark: async (id, text) => {
      await adminAddRemark(password, sheet, id, text, adminName);
      load();
    },
    deleteLead: async (id) => {
      await adminDeleteLead(password, sheet, id);
      load();
    },
    addVisit: async (id, visit) => {
      await adminAddVisit(password, sheet, id, visit, adminName);
      load();
    },
    shareToGallery: async (propertyId, payload) => {
      if (propertyId) {
        await adminUpdateProperty(password, propertyId, payload);
        return propertyId;
      }
      const { id } = await adminAddProperty(password, payload);
      return id;
    },
  };

  const areaOptions = useMemo(() => {
    if (!leads) return [];
    const set = new Set(leads.map((l) => l.area).filter(Boolean));
    return [...set].sort();
  }, [leads]);

  const facets = useMemo(() => {
    if (!leads) return {};
    const result = {};

    // Built-in facets from known enumerated fields (e.g. Property type)
    facetFields.forEach(([key, facetLabel]) => {
      leads.forEach((l) => {
        const value = l[key];
        if (!value) return;
        if (!result[facetLabel]) result[facetLabel] = {};
        result[facetLabel][value] = (result[facetLabel][value] || 0) + 1;
      });
    });

    // Ad-hoc facets from custom fields the admin has tagged onto leads
    leads.forEach((l) => {
      const cf = parseCustomFields(l);
      Object.entries(cf).forEach(([name, value]) => {
        if (!value || name === "floorPlan") return;
        if (!result[name]) result[name] = {};
        result[name][value] = (result[name][value] || 0) + 1;
      });
    });

    return result;
  }, [leads, facetFields]);

  // Maps a facet label to how to read that value off a lead — either a
  // known built-in field (propertyType, etc.) or an ad-hoc custom field.
  const facetKeyLookup = useMemo(() => {
    const map = {};
    facetFields.forEach(([key, facetLabel]) => {
      map[facetLabel] = { type: "field", key };
    });
    return map;
  }, [facetFields]);

  const getFacetValue = useCallback(
    (lead, facetName) => {
      const known = facetKeyLookup[facetName];
      if (known) return lead[known.key];
      return parseCustomFields(lead)[facetName];
    },
    [facetKeyLookup]
  );

  const facetActiveCount = Object.values(selectedFacets).reduce((sum, arr) => sum + arr.length, 0);

  const advancedActiveCount =
    selectedAreas.length + [budgetMin, budgetMax, sqftMin, sqftMax].filter((v) => v !== "").length + facetActiveCount;

  const filtered = useMemo(() => {
    if (!leads) return [];
    const q = query.trim().toLowerCase();
    const out = leads.filter((l) => {
      const matchesQuery =
        !q ||
        l.name?.toLowerCase().includes(q) ||
        String(l.phone || "").includes(q) ||
        l.id?.toLowerCase().includes(q);
      const matchesStatus = view === "board" || activeStatus === "All" || (l.status || statuses[0]) === activeStatus;
      const matchesStatus2 = !statuses2 || activeStatus2 === "All" || l.status2 === activeStatus2;
      const matchesArea = selectedAreas.length === 0 || selectedAreas.includes(l.area);
      const budget = Number(l.budgetValue);
      const matchesBudget =
        (!budgetMin && !budgetMax) ||
        (Number.isFinite(budget) &&
          (!budgetMin || budget >= Number(budgetMin)) &&
          (!budgetMax || budget <= Number(budgetMax)));
      const sqft = Number(l.sqft);
      const matchesSqft =
        (!sqftMin && !sqftMax) ||
        (Number.isFinite(sqft) &&
          (!sqftMin || sqft >= Number(sqftMin)) &&
          (!sqftMax || sqft <= Number(sqftMax)));
      const matchesFacets = Object.entries(selectedFacets).every(([name, values]) => {
        if (values.length === 0) return true;
        return values.includes(getFacetValue(l, name));
      });
      return matchesQuery && matchesStatus && matchesStatus2 && matchesArea && matchesBudget && matchesSqft && matchesFacets;
    });
    if (sortBy === "newest") return out; // `leads` is already newest-first
    const by = {
      hottest: (l) => -leadScore(type, l).score,
      followup: (l) => {
        const d = parseDay(l.followUpDate);
        return d ? d.getTime() : Infinity;
      },
      priority: (l) => -(Number(l.priority) || 0),
    }[sortBy];
    return by ? [...out].sort((a, b) => by(a) - by(b)) : out;
  }, [leads, query, activeStatus, activeStatus2, selectedAreas, budgetMin, budgetMax, sqftMin, sqftMax, selectedFacets, statuses, statuses2, getFacetValue, sortBy, type, view]);

  const counts = useMemo(() => {
    const c = { All: leads?.length || 0 };
    statuses.forEach((s) => {
      c[s] = leads ? leads.filter((l) => (l.status || statuses[0]) === s).length : 0;
    });
    return c;
  }, [leads, statuses]);

  const counts2 = useMemo(() => {
    if (!statuses2) return {};
    const c = { All: leads?.length || 0 };
    statuses2.forEach((s) => {
      c[s] = leads ? leads.filter((l) => l.status2 === s).length : 0;
    });
    return c;
  }, [leads, statuses2]);

  const openLead = openLeadId ? leads?.find((l) => l.id === openLeadId) : null;

  function toggleArea(a) {
    setSelectedAreas((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  function toggleFacetValue(name, value) {
    setSelectedFacets((prev) => {
      const current = prev[name] || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [name]: next };
    });
  }

  function clearAdvanced() {
    setSelectedAreas([]);
    setBudgetMin(""); setBudgetMax(""); setSqftMin(""); setSqftMax("");
    setSelectedFacets({});
  }

  function handleDownload() {
    downloadReport({
      roleLabel: label,
      accent,
      fields,
      leads: filtered,
      filterLabel: activeStatus === "All" ? "All leads" : activeStatus,
      statuses,
    });
  }

  async function handleCreateFieldVisit({ name, phone, photoUrl, lat, lng, address }) {
    const { id } = await addSellerLead({
      name,
      phone,
      propertyType: "",
      propertyLocation: address || "",
      propertyStatus: "",
      expectedPrice: "",
      ownership: "",
      timeline: "",
    });
    await adminAddVisit(password, sheet, id, { photoUrl, lat, lng, address }, adminName);
    setShowNewVisit(false);
    load();
  }

  if (error) {
    return (
      <p className="alert-error">
        {error}
      </p>
    );
  }

  function clearAll() {
    setQuery("");
    setActiveStatus("All");
    setActiveStatus2("All");
    clearAdvanced();
  }

  const nothingYet = leads !== null && leads.length === 0;

  return (
    <div style={{ "--accent": accent }}>
      {/* Summary */}
      <div className="rounded-2xl bg-surface border border-ink/10 p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-12 h-12 rounded-xl flex items-center justify-center font-display font-bold text-xl text-white shrink-0" style={{ backgroundColor: accent }}>
            {label[0]}
          </span>
          <div className="min-w-0">
            <h2 className="font-display font-bold text-[1.25rem] leading-tight text-ink">{label} leads</h2>
            <p className="text-xs text-ink/55 mt-0.5">
              {counts.All} total{leads !== null && filtered.length !== counts.All ? ` · ${filtered.length} showing` : ""}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {sheet === "Sellers" && (
            <button onClick={() => setShowNewVisit(true)} className={btnGreen}>
              <Camera size={14} strokeWidth={2.25} />
              Field visit
            </button>
          )}
          <button onClick={handleDownload} disabled={!leads || filtered.length === 0} className={btnDark}>
            <FileText size={14} />
            Report
          </button>
        </div>
      </div>

      {/* Pipeline filter (the board view shows every stage as a column instead) */}
      {view !== "board" && (
      <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar pb-1" role="group" aria-label="Filter by status">
        {["All", ...statuses].map((s) => (
          <Chip key={s} active={activeStatus === s} onClick={() => setActiveStatus(s)} dot={s === "All" ? null : getStatusStyle(s, statuses).dot}>
            {s} <span className="opacity-60">({counts[s] ?? 0})</span>
          </Chip>
        ))}
      </div>
      )}

      {statuses2 && (
        <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar pb-1 items-center" role="group" aria-label={status2Label || "Second pipeline"}>
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink/50 shrink-0 pr-1">{status2Label || "Second pipeline"}</span>
          {["All", ...statuses2].map((s) => (
            <Chip key={s} active={activeStatus2 === s} onClick={() => setActiveStatus2(s)} dot={s === "All" ? null : getStatusStyle(s, statuses2).dot}>
              {s} <span className="opacity-60">({counts2[s] ?? 0})</span>
            </Chip>
          ))}
        </div>
      )}

      {/* Search + filters */}
      <div className="mt-3 flex flex-wrap gap-2.5">
        <div className="relative flex-1 min-w-0 basis-full sm:basis-0">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/35" />
          <input
            className={`${adminInputCls} !pl-10 !bg-surface`}
            placeholder="Search name, phone, ID"
            aria-label="Search leads"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex shrink-0 rounded-xl border border-ink/10 bg-surface p-1 gap-1" role="group" aria-label="Choose list or board view">
          {[["list", LayoutGrid, "Cards"], ["board", Columns3, "Board"]].map(([k, Icon, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => chooseView(k)}
              aria-pressed={view === k}
              className={`h-10 px-3 rounded-lg text-[12.5px] font-semibold flex items-center gap-1.5 transition-colors ${view === k ? "bg-ink text-white" : "text-ink/60 hover:text-ink"}`}
            >
              <Icon size={15} /> <span className="hidden sm:inline">{l}</span>
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          aria-label="Sort leads"
          className="flex-1 sm:flex-none sm:shrink-0 h-[3rem] px-3 rounded-xl border border-ink/10 bg-surface text-[13px] font-semibold text-ink/75 outline-none focus:border-[color:var(--accent)]"
        >
          <option value="newest">Newest</option>
          <option value="hottest">Hottest first</option>
          <option value="followup">Follow-up soonest</option>
          <option value="priority">Highest priority</option>
        </select>
        <button
          onClick={() => setShowAdvanced(true)}
          className={`shrink-0 h-[3rem] px-4 rounded-xl border text-[13px] font-semibold flex items-center gap-2 transition-colors ${
            advancedActiveCount > 0 ? "bg-ink text-white border-ink" : "bg-surface text-ink/75 border-ink/10 hover:border-ink/30"
          }`}
        >
          <SlidersHorizontal size={15} />
          <span className="hidden sm:inline">Filters</span>
          {advancedActiveCount > 0 && <span className="bg-white/20 rounded-full px-1.5 text-[11px]">{advancedActiveCount}</span>}
        </button>
      </div>

      {/* Results */}
      <div className="mt-5">
        {leads === null && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl bg-surface border border-ink/10 p-4 space-y-3">
                <div className="h-5 w-2/3 rounded-md skeleton" />
                <div className="h-4 w-1/3 rounded-md skeleton" />
                <div className="h-10 w-full rounded-full skeleton" />
                <div className="h-11 w-full rounded-full skeleton" />
              </div>
            ))}
          </div>
        )}

        {nothingYet && (
          <div className="rounded-2xl bg-surface border border-dashed border-ink/20 p-8 text-center">
            <p className="font-display font-bold text-lg text-ink">No {label.toLowerCase()} leads yet</p>
            <p className="text-sm text-ink/55 mt-1">They appear here as soon as someone submits the {label.toLowerCase()} form.</p>
          </div>
        )}

        {leads !== null && !nothingYet && filtered.length === 0 && (
          <div className="rounded-2xl bg-surface border border-dashed border-ink/20 p-8 text-center">
            <p className="font-display font-bold text-lg text-ink">No leads match</p>
            <p className="text-sm text-ink/55 mt-1">Try a different search or clear the filters.</p>
            <button onClick={clearAll} className={`${btnOutline} mx-auto mt-4`}>Clear filters</button>
          </div>
        )}

        {moveError && <p className="alert-error mb-3">{moveError}</p>}

        {view === "board" && leads !== null && !nothingYet && (
          <KanbanBoard
            role={type}
            leads={filtered}
            statuses={statuses}
            styleFor={(st) => getStatusStyle(st, statuses)}
            accent={accent}
            onMove={moveLead}
            onOpen={(id) => setOpenLeadId(id)}
          />
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
          {view !== "board" && filtered.map((lead) => (
            <LeadCard key={lead.id} lead={lead} role={type} adminName={adminName} accent={accent} onOpen={() => setOpenLeadId(lead.id)} statuses={statuses} statuses2={statuses2} fields={fields} />
          ))}
        </div>
      </div>

      {openLead && (
        <LeadDetailModal
          lead={openLead}
          fields={fields}
          accent={accent}
          sheet={sheet}
          roleLabel={label}
          statuses={statuses}
          statuses2={statuses2}
          status2Label={status2Label}
          onClose={() => { setOpenLeadId(null); if (onOpenHandled) onOpenHandled(); }}
          onSaveDetails={onChanged.updateMeta}
          onAddRemark={onChanged.addRemark}
          onShareGallery={onChanged.shareToGallery}
          onDeleteLead={onChanged.deleteLead}
        />
      )}

      {showAdvanced && (
        <FiltersSheet
          accent={accent}
          resultCount={filtered.length}
          areas={areaOptions}
          selectedAreas={selectedAreas}
          onToggleArea={toggleArea}
          budgetMin={budgetMin} budgetMax={budgetMax} setBudgetMin={setBudgetMin} setBudgetMax={setBudgetMax}
          sqftMin={sqftMin} sqftMax={sqftMax} setSqftMin={setSqftMin} setSqftMax={setSqftMax}
          facets={facets}
          selectedFacets={selectedFacets}
          onToggleFacetValue={toggleFacetValue}
          onClear={clearAdvanced}
          onClose={() => setShowAdvanced(false)}
        />
      )}

      {showNewVisit && (
        <NewFieldVisitModal accent={accent} onClose={() => setShowNewVisit(false)} onCreate={handleCreateFieldVisit} />
      )}
    </div>
  );
}
