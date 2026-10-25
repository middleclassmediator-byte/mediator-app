// Builds a polished, branded PDF report for a set of CRM leads (name,
// contact details, priority, follow-up date, and the full dated remarks
// history) using jsPDF + jspdf-autotable, then triggers a download.

// jsPDF is large, so it is loaded only when a PDF is actually requested.
async function loadPdf() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  return { jsPDF, autoTable };
}
import { whatsappLink } from "./whatsapp";
import { ADMIN_WHATSAPP_NUMBER } from "./config";
import { optimizedImageUrl } from "./cloudinary";
import { priceValue } from "./gallery";
import { needsCanvasText, loadImage, coverJpeg, containPng, textImage, wrapText, linesImage } from "./pdfImage";

const GOLD = [200, 155, 60];
const PAPER = [250, 246, 239];

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function parseRemarksLog(lead) {
  let log = [];
  if (lead.remarksLog) {
    try {
      const parsed = JSON.parse(lead.remarksLog);
      if (Array.isArray(parsed)) log = parsed;
    } catch {
      // fall through to legacy handling below
    }
  }
  if (log.length === 0 && lead.remarks) {
    log = [{ text: lead.remarks, at: lead.timestamp, by: "" }];
  }
  return [...log].sort((a, b) => new Date(b.at) - new Date(a.at));
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

// Turns an internal field name like "galleryId" into "Gallery ID" for
// display — jsPDF's core fonts can only render plain Latin text reliably,
// so keep this ASCII-only too.
// jsPDF's core fonts can't render ₹ (or emoji/stars — see other fixes in
// this file); swap it for plain "Rs." wherever price text might appear.
function pdfSafe(text) {
  if (text === null || text === undefined) return text;
  // Keep the writer's line breaks (remarks are often several lines); only
  // tidy runs of spaces/tabs. The old version flattened every newline.
  return String(text)
    .replace(/₹/g, "Rs. ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function prettifyKey(key) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced
    .split(" ")
    .map((w) => (w.toLowerCase() === "id" ? "ID" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// Prefers a manually pasted Google Maps link; then exact GPS coordinates
// from the most recent site visit; then a text-based map search on the
// address, then the general area.
function buildMapUrl(lead, visitLog) {
  if (lead.mapLink && /^https?:\/\//i.test(lead.mapLink.trim())) return lead.mapLink.trim();
  const withCoords = visitLog.find((v) => v.lat && v.lng);
  if (withCoords) return `https://www.google.com/maps?q=${withCoords.lat},${withCoords.lng}`;
  const withAddress = visitLog.find((v) => v.address);
  const query = lead.exactAddress || withAddress?.address || lead.propertyLocation || lead.area;
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// Status colors are now assigned by position within whatever pipeline the
// role uses (passed in as `statuses`), since each role has its own custom
// stage names rather than one shared New/Contacted/Closed set.
const STATUS_PALETTE = [
  [200, 155, 60],
  [14, 165, 233],
  [139, 92, 246],
  [16, 185, 129],
  [181, 83, 60],
  [148, 163, 184],
];

function getStatusColor(status, statuses) {
  const idx = statuses ? statuses.indexOf(status) : -1;
  return STATUS_PALETTE[idx >= 0 ? idx % STATUS_PALETTE.length : STATUS_PALETTE.length - 1];
}

// A table cell that survives text jsPDF's core fonts can't draw (₹, Tamil,
// emoji). Plain Latin text stays a normal string (selectable, searchable);
// anything else is rendered via canvas and drawn into the cell as an image,
// with the row grown to fit it. Line breaks are kept either way.
function richCell(text, widthPt, { sizePt = 9, pad = 4 } = {}) {
  const value = pdfSafe(text) ?? "";
  if (!needsCanvasText(text)) return value;
  const raw = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  const lineHeightPt = sizePt * 1.4;
  const img = textImage(raw, { widthPt, sizePt, color: "rgb(30, 30, 40)", lineHeightPt });
  return { content: "", _img: img, _pad: pad, styles: { minCellHeight: img.hPt + pad * 2 } };
}

function drawRichCell(doc) {
  return (data) => {
    const raw = data.cell.raw;
    if (raw && raw._img && data.section === "body") {
      doc.addImage(raw._img.dataUrl, "PNG", data.cell.x + 4, data.cell.y + raw._pad, raw._img.wPt, raw._img.hPt);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Customer brochure — the PDF the admin shares with a buyer.
// Layout: branded header → title + type/status pills → price card → photo
// hero + thumbnails → key-facts grid → floor plan → seller's remark →
// contact card, with a numbered footer on every page. Photos are cropped
// (never stretched) and text that jsPDF's core fonts can't draw (₹, Tamil,
// emoji, line breaks in remarks) is rendered through the browser instead.
// ─────────────────────────────────────────────────────────────────────────
const NAVY = [27, 42, 74];
const GOLD_DARK = [168, 120, 42];
const INK = [30, 30, 40];
const MUTED = [112, 117, 132];
const LINE = [228, 222, 210];
const TINT = [250, 246, 239];

const rgbCss = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;

function formatPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 12) return `+${d.slice(0, 2)} ${d.slice(2, 7)} ${d.slice(7)}`;
  return d ? `+${d}` : "";
}

export async function downloadBrochure(property) {
  const { jsPDF } = await loadPdf();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36; // page margin
  const CW = W - M * 2; // content width
  const FOOT = 46; // space kept free at the bottom for the footer
  let y = 0;

  // ---- data -----------------------------------------------------------
  let attributes = {};
  if (property.attributes) {
    try {
      const parsed = JSON.parse(property.attributes);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) attributes = parsed;
    } catch {
      // ignore — facts just won't include extra attributes
    }
  }
  const floorPlanUrl = property.floorPlan || attributes.__floorPlan || "";
  delete attributes.__floorPlan;

  let imageUrls = [];
  if (property.images) {
    try {
      const parsed = JSON.parse(property.images);
      if (Array.isArray(parsed)) imageUrls = parsed.filter(Boolean);
    } catch {
      // fall through to imageUrl
    }
  }
  if (imageUrls.length === 0 && property.imageUrl) imageUrls = [property.imageUrl];
  imageUrls = imageUrls.slice(0, 4);

  // Load everything up-front, in parallel — a slow photo shouldn't stall the rest.
  const [photoImgs, floorImg] = await Promise.all([
    Promise.all(imageUrls.map((u) => loadImage(optimizedImageUrl(u, 1600)))),
    floorPlanUrl ? loadImage(optimizedImageUrl(floorPlanUrl, 1800)) : Promise.resolve(null),
  ]);
  const photos = photoImgs.filter(Boolean);

  // ---- small drawing helpers -------------------------------------------
  // Draws text natively when jsPDF can handle it, otherwise through canvas.
  // `y` is the TOP of the text block; returns the height used.
  function drawText(str, x, top, { size = 10, bold = false, italic = false, color = INK, maxWidth = CW, font = "helvetica", lineGap = 1.35 } = {}) {
    const text = String(str ?? "");
    if (!text) return 0;
    if (needsCanvasText(text)) {
      const img = textImage(text, { widthPt: maxWidth, sizePt: size, weight: bold ? 700 : 400, italic, color: rgbCss(color), lineHeightPt: size * lineGap });
      doc.addImage(img.dataUrl, "PNG", x, top, img.wPt, img.hPt);
      return img.hPt;
    }
    doc.setFont(font, bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text.replace(/\s+/g, " ").trim(), maxWidth);
    doc.text(lines, x, top, { baseline: "top", lineHeightFactor: lineGap });
    return lines.length * size * lineGap;
  }

  // How tall drawText would be, without drawing — for card sizing.
  function measureTextHeight(str, { size = 10, bold = false, italic = false, maxWidth = CW, font = "helvetica", lineGap = 1.35 } = {}) {
    const text = String(str ?? "");
    if (!text) return 0;
    if (needsCanvasText(text)) return wrapText(text, { widthPt: maxWidth, sizePt: size, weight: bold ? 700 : 400, italic }).length * size * lineGap;
    doc.setFont(font, bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal");
    doc.setFontSize(size);
    return doc.splitTextToSize(text.replace(/\s+/g, " ").trim(), maxWidth).length * size * lineGap;
  }

  function pill(label, x, top, { fill, color = [255, 255, 255], size = 8 }) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    const w = doc.getTextWidth(label) + 18;
    doc.setFillColor(...fill);
    doc.roundedRect(x, top, w, 18, 9, 9, "F");
    doc.setTextColor(...color);
    doc.text(label, x + w / 2, top + 9, { align: "center", baseline: "middle" });
    return w;
  }

  function logo(cx, cy, r, ringColor) {
    doc.setDrawColor(...ringColor);
    doc.setLineWidth(1.2);
    doc.circle(cx, cy, r, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(r * 0.58);
    doc.setTextColor(...ringColor);
    doc.text("MCM", cx, cy, { align: "center", baseline: "middle" });
  }

  function drawFirstHeader() {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 86, "F");
    doc.setFillColor(...GOLD);
    doc.rect(0, 86, W, 3, "F");
    logo(M + 20, 43, 20, [255, 255, 255]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(255, 255, 255);
    doc.text("MIDDLE CLASS MEDIATOR", M + 54, 36);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(214, 190, 130);
    doc.text("Verified property mediation  |  Chennai", M + 54, 52);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text("PROPERTY BROCHURE", W - M, 36, { align: "right" });
    if (property.refId) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(214, 190, 130);
      doc.text(`Ref: ${property.refId}`, W - M, 52, { align: "right" });
    }
  }

  function drawSlimHeader() {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 40, "F");
    doc.setFillColor(...GOLD);
    doc.rect(0, 40, W, 2, "F");
    logo(M + 11, 20, 11, [255, 255, 255]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text("MIDDLE CLASS MEDIATOR", M + 30, 20, { baseline: "middle" });
    if (property.refId) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(214, 190, 130);
      doc.text(`Ref: ${property.refId}`, W - M, 20, { align: "right", baseline: "middle" });
    }
  }

  function newPage() {
    doc.addPage();
    drawSlimHeader();
    y = 64;
  }

  // Starts a new page when the next block wouldn't fit above the footer.
  function ensure(height) {
    if (y + height > H - FOOT) newPage();
  }

  function sectionTitle(label) {
    ensure(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...GOLD_DARK);
    doc.text(label.toUpperCase(), M, y, { baseline: "top" });
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.8);
    const tw = doc.getTextWidth(label.toUpperCase());
    doc.line(M + tw + 10, y + 5, W - M, y + 5);
    y += 20;
  }

  // ---- page 1 ----------------------------------------------------------
  drawFirstHeader();
  y = 112;

  // Type + status pills
  let px = M;
  const typeLabel = pdfSafe(property.type);
  const statusLabel = pdfSafe(property.description);
  if (typeLabel) px += pill(typeLabel.toUpperCase(), px, y, { fill: NAVY }) + 6;
  if (statusLabel && statusLabel.length < 40) pill(statusLabel.toUpperCase(), px, y, { fill: [244, 233, 207], color: [138, 98, 24] });
  y += typeLabel || statusLabel ? 30 : 0;

  // Title
  y += drawText(property.title || "Property", M, y, { size: 24, bold: true, color: NAVY, font: "times", lineGap: 1.15 }) + 6;

  // Location
  if (property.location) {
    doc.setFillColor(...GOLD_DARK);
    doc.circle(M + 4, y + 6, 3.6, "F");
    doc.setFillColor(255, 255, 255);
    doc.circle(M + 4, y + 6, 1.4, "F");
    y += drawText(property.location, M + 16, y, { size: 11, color: MUTED, maxWidth: CW - 16 }) + 14;
  } else {
    y += 8;
  }

  // Price card
  const priceNum = priceValue(property.price);
  const sqftNum = Number(String(property.sqft || "").replace(/[^\d.]/g, "")) || null;
  const perSqft = priceNum && sqftNum && priceNum >= 100000 ? Math.round(priceNum / sqftNum) : null;
  const cardH = 70;
  doc.setFillColor(...TINT);
  doc.roundedRect(M, y, CW, cardH, 10, 10, "F");
  doc.setFillColor(...GOLD);
  doc.roundedRect(M, y, 5, cardH, 2.5, 2.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...GOLD_DARK);
  doc.text("ASKING PRICE", M + 22, y + 15, { baseline: "top" });
  const priceText = property.price || "Price on request";
  drawText(priceText, M + 22, y + 30, { size: property.price ? 27 : 17, bold: true, color: NAVY, maxWidth: perSqft ? CW * 0.6 : CW - 44, lineGap: 1.1 });
  if (perSqft) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("PER SQ.FT", W - M - 20, y + 15, { align: "right", baseline: "top" });
    drawText(`₹${perSqft.toLocaleString("en-IN")}`, W - M - 20 - 110, y + 31, { size: 17, bold: true, color: INK, maxWidth: 110, lineGap: 1.1 });
  }
  y += cardH + 18;

  // Photos: cropped to fit, never stretched.
  if (photos.length > 0) {
    const heroH = 250;
    const hero = coverJpeg(photos[0], CW, heroH, 8);
    doc.addImage(hero, "JPEG", M, y, CW, heroH);
    y += heroH + 8;
    const extras = photos.slice(1, 4);
    if (extras.length > 0) {
      const gap = 8;
      const tw = (CW - gap * (extras.length - 1)) / extras.length;
      const th = Math.min(96, tw * 0.62);
      extras.forEach((img, i) => {
        doc.addImage(coverJpeg(img, tw, th, 6), "JPEG", M + i * (tw + gap), y, tw, th);
      });
      y += th + 8;
    }
    y += 10;
  }

  // Key facts grid
  const facts = [];
  if (property.type) facts.push(["Property type", pdfSafe(property.type)]);
  if (property.location) facts.push(["Location", pdfSafe(property.location)]);
  if (sqftNum) facts.push(["Size", `${sqftNum.toLocaleString("en-IN")} sq.ft`]);
  if (property.description) facts.push(["Status", pdfSafe(property.description)]);
  Object.entries(attributes).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== "") facts.push([prettifyKey(k), pdfSafe(v)]);
  });

  if (facts.length > 0) {
    sectionTitle("Property details");
    const cols = 3;
    const gap = 8;
    const cellW = (CW - gap * (cols - 1)) / cols;
    const pad = 11;
    for (let i = 0; i < facts.length; i += cols) {
      const row = facts.slice(i, i + cols);
      const heights = row.map(([, v]) => measureTextHeight(v, { size: 10.5, bold: true, maxWidth: cellW - pad * 2 }));
      const rowH = Math.max(...heights) + 32;
      ensure(rowH + 4);
      row.forEach(([label, value], c) => {
        const cx = M + c * (cellW + gap);
        doc.setFillColor(...TINT);
        doc.roundedRect(cx, y, cellW, rowH, 7, 7, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...MUTED);
        doc.text(label.toUpperCase(), cx + pad, y + 11, { baseline: "top" });
        drawText(value, cx + pad, y + 24, { size: 10.5, bold: true, color: INK, maxWidth: cellW - pad * 2 });
      });
      y += rowH + gap;
    }
    y += 8;
  }

  // Floor plan / sketch — fitted whole, never cropped.
  if (floorImg) {
    const maxH = 330;
    const fit = containPng(floorImg, CW - 24, maxH);
    ensure(fit.hPt + 62);
    sectionTitle("Floor plan");
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.8);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(M, y, CW, fit.hPt + 24, 8, 8, "FD");
    doc.addImage(fit.dataUrl, "JPEG", M + (CW - fit.wPt) / 2, y + 12, fit.wPt, fit.hPt);
    y += fit.hPt + 24 + 8;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text("Sketch for reference. Dimensions and layout are indicative.", M, y, { baseline: "top" });
    y += 22;
  }

  // Seller's remark — word-wrapped, keeps the seller's own line breaks, and
  // continues onto the next page instead of being cut off.
  const note = String(property.sellerNote || "").trim();
  if (note) {
    sectionTitle("Seller's remark");
    const size = 10.5;
    const lh = size * 1.5;
    const innerW = CW - 38;
    const lines = wrapText(note, { widthPt: innerW, sizePt: size, italic: true });
    let i = 0;
    while (i < lines.length) {
      if (y + lh * 3 + 24 > H - FOOT) newPage();
      const room = Math.floor((H - FOOT - y - 24) / lh);
      const chunk = lines.slice(i, i + Math.max(room, 1));
      const boxH = chunk.length * lh + 24;
      doc.setFillColor(251, 245, 230);
      doc.roundedRect(M, y, CW, boxH, 8, 8, "F");
      doc.setFillColor(...GOLD);
      doc.roundedRect(M, y, 4, boxH, 2, 2, "F");
      const img = linesImage(chunk, { widthPt: innerW, sizePt: size, italic: true, color: "rgb(58, 58, 70)", lineHeightPt: lh });
      doc.addImage(img.dataUrl, "PNG", M + 20, y + 12, img.wPt, img.hPt);
      y += boxH + 6;
      i += chunk.length;
    }
    y += 14;
  }

  // Contact card
  const contact = formatPhone(ADMIN_WHATSAPP_NUMBER);
  const ctaH = 92;
  ensure(ctaH + 8);
  doc.setFillColor(...NAVY);
  doc.roundedRect(M, y, CW, ctaH, 12, 12, "F");
  doc.setFillColor(...GOLD);
  doc.rect(M + 24, y + 22, 26, 2.5, "F");
  doc.setFont("times", "bold");
  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.text("Interested in this property?", M + 24, y + 32, { baseline: "top" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(214, 190, 130);
  doc.text("Talk to us directly. We arrange the visit and guide you to closing.", M + 24, y + 56, { baseline: "top" });
  if (contact) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(contact, M + 24, y + 70, { baseline: "top" });
  }
  const btnW = 170;
  const btnH = 38;
  const btnX = W - M - 24 - btnW;
  const btnY = y + (ctaH - btnH) / 2;
  doc.setFillColor(37, 211, 102);
  doc.roundedRect(btnX, btnY, btnW, btnH, 19, 19, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text("Chat on WhatsApp", btnX + btnW / 2, btnY + btnH / 2, { align: "center", baseline: "middle" });
  const priceForMsg = String(property.price || "").replace(/\s+/g, " ").trim();
  const waUrl = whatsappLink(
    ADMIN_WHATSAPP_NUMBER,
    `Hi, I'm interested in this property: ${property.title || ""}${property.location ? ` (${property.location})` : ""}${priceForMsg ? ` - ${priceForMsg}` : ""}${property.refId ? `\n\nProperty ref: ${property.refId}` : ""}\n\nCan you share more details?`
  );
  doc.link(btnX, btnY, btnW, btnH, { url: waUrl });
  y += ctaH;

  // Footer on every page
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.7);
    doc.line(M, H - 34, W - M, H - 34);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...NAVY);
    doc.text("Middle Class Mediator", M, H - 26, { baseline: "top" });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text("Details are shared by the owner. Please verify documents before purchase.", M + 96, H - 26, { baseline: "top" });
    doc.text(`Page ${p} of ${pages}`, W - M, H - 26, { align: "right", baseline: "top" });
  }

  const safeTitle = String(property.title || "property").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "property";
  doc.save(`${safeTitle}-brochure.pdf`);
}

export async function downloadReport({ roleLabel, accent, fields, leads, filterLabel, statuses }) {
  const { jsPDF, autoTable } = await loadPdf();
  const [r, g, b] = hexToRgb(accent);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const generatedAt = new Date().toLocaleString();

  const counts = leads.reduce((acc, l) => {
    const s = l.status || "New";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  function drawBanner() {
    // Role-colored banner with a subtle depth overlay and a gold accent stripe
    doc.setFillColor(r, g, b);
    doc.rect(0, 0, pageWidth, 96, "F");
    doc.setFillColor(0, 0, 0);
    doc.setGState(new doc.GState({ opacity: 0.12 }));
    doc.rect(0, 60, pageWidth, 36, "F");
    doc.setGState(new doc.GState({ opacity: 1 }));
    doc.setFillColor(...GOLD);
    doc.rect(0, 96, pageWidth, 2.5, "F");

    // Circular MCM badge
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(1.1);
    doc.circle(margin + 15, 32, 15, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text("MCM", margin + 15, 35, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(255, 255, 255);
    doc.text(`${roleLabel} CRM Report`, margin + 40, 28);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.text(
      `${filterLabel || "All leads"}  ·  ${leads.length} lead${leads.length === 1 ? "" : "s"}  ·  Generated ${generatedAt}`,
      margin + 40,
      44
    );

    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text("MIDDLE CLASS MEDIATOR  ·  CONFIDENTIAL CRM REPORT", margin + 40, 58);

    // Status summary pills
    let px = margin;
    const py = 72;
    doc.setFontSize(7.5);
    Object.entries(counts).forEach(([status, count]) => {
      const label = `${status}: ${count}`;
      const w = doc.getTextWidth(label) + 14;
      doc.setFillColor(255, 255, 255);
      doc.setGState(new doc.GState({ opacity: 0.18 }));
      doc.roundedRect(px, py, w, 16, 8, 8, "F");
      doc.setGState(new doc.GState({ opacity: 1 }));
      doc.setFont("helvetica", "bold");
      doc.setTextColor(255, 255, 255);
      doc.text(label, px + w / 2, py + 11, { align: "center" });
      px += w + 6;
    });

    doc.setTextColor(20, 20, 30);
  }

  function drawFooter(pageNum, totalPages) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 160);
    doc.text("Middle Class Mediator", margin, pageHeight - 20);
    doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin, pageHeight - 20, { align: "right" });
    doc.setDrawColor(230, 225, 215);
    doc.setLineWidth(0.5);
    doc.line(margin, pageHeight - 28, pageWidth - margin, pageHeight - 28);
  }

  drawBanner();
  let y = 128;

  if (leads.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(120, 120, 130);
    doc.text("No leads in this view.", margin, y);
  }

  for (const lead of leads) {
    const visitLog = parseVisitLog(lead);
    const photoUrls = parsePhotos(lead).length ? parsePhotos(lead) : (visitLog.find((v) => v.photoUrl)?.photoUrl ? [visitLog.find((v) => v.photoUrl).photoUrl] : []);
    const thumbSize = 62;
    const photoDatas = [];
    for (const url of photoUrls) {
      const img = await loadImage(optimizedImageUrl(url, 500));
      if (img) photoDatas.push(coverJpeg(img, thumbSize - 2, thumbSize - 2, 3));
    }
    const hasPhotos = photoDatas.length > 0;
    const photoRowH = hasPhotos ? thumbSize + 12 : 0;

    // Rough space check before starting a new lead card
    if (y > pageHeight - 190 - photoRowH) {
      doc.addPage();
      drawBanner();
      y = 128;
    }

    const cardTop = y;
    const status = lead.status || "New";
    const sColor = getStatusColor(status, statuses);
    const priority = Math.max(0, Math.min(5, Number(lead.priority) || 0));

    // Card background + left accent bar
    doc.setFillColor(...PAPER);
    doc.roundedRect(margin, cardTop, pageWidth - margin * 2, 34, 6, 6, "F");
    doc.setFillColor(r, g, b);
    doc.rect(margin, cardTop, 4, 34, "F");

    const textX = margin + 14;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20, 20, 30);
    doc.text(pdfSafe(lead.name) || "(no name)", textX, cardTop + 16);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(110, 110, 120);
    doc.text(`#${lead.id}`, textX, cardTop + 28);

    // Status pill
    const statusLabel = status;
    doc.setFontSize(8);
    const pillW = doc.getTextWidth(statusLabel) + 16;
    const pillX = pageWidth - margin - pillW - 70;
    doc.setFillColor(...sColor);
    doc.roundedRect(pillX, cardTop + 8, pillW, 15, 7.5, 7.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text(statusLabel, pillX + pillW / 2, cardTop + 18, { align: "center" });

    // Priority — drawn as filled/outline circle pips, not star glyphs (jsPDF's
    // core fonts can't render ★/☆ or emoji reliably; vector shapes always work)
    const pipR = 3;
    const pipGap = 9;
    let pipX = pageWidth - margin - pipR - (5 - 1) * pipGap;
    for (let i = 0; i < 5; i++) {
      if (i < priority) {
        doc.setFillColor(...GOLD);
        doc.circle(pipX, cardTop + 16, pipR, "F");
      } else {
        doc.setDrawColor(210, 205, 195);
        doc.setLineWidth(0.7);
        doc.circle(pipX, cardTop + 16, pipR, "S");
      }
      pipX += pipGap;
    }

    y = cardTop + 34 + 10;

    // Clickable owner phone (→ WhatsApp) and map location links
    if (lead.phone) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(r, g, b);
      const phoneLabel = `${lead.phone} — Message on WhatsApp`;
      doc.textWithLink(phoneLabel, textX, y, { url: whatsappLink(lead.phone, `Hi ${lead.name || ""}, following up on your property`) });
      const phoneW = doc.getTextWidth(phoneLabel);
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(0.6);
      doc.line(textX, y + 2, textX + phoneW, y + 2);
    }

    const mapUrl = buildMapUrl(lead, visitLog);
    if (mapUrl) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(r, g, b);
      const mapLabel = "View exact location on map";
      const mapX = pageWidth - margin - doc.getTextWidth(mapLabel);
      doc.textWithLink(mapLabel, mapX, y, { url: mapUrl });
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(0.6);
      doc.line(mapX, y + 2, mapX + doc.getTextWidth(mapLabel), y + 2);
    }

    if (lead.phone || mapUrl) y += 16;

    // Photo strip (up to 4)
    if (hasPhotos) {
      let px = textX;
      photoDatas.forEach((d) => {
        try {
          doc.setDrawColor(230, 225, 215);
          doc.setLineWidth(0.5);
          doc.roundedRect(px, y, thumbSize, thumbSize, 4, 4, "S");
          doc.addImage(d, "JPEG", px + 1, y + 1, thumbSize - 2, thumbSize - 2, undefined, "FAST");
        } catch {
          // unsupported image format — skip silently, rest of the report still renders
        }
        px += thumbSize + 8;
      });
      y += thumbSize + 12;
    }

    const detailRows = fields
      .filter(([key]) => lead[key])
      .map(([key, label]) => [pdfSafe(label), /^\d{4,}$/.test(String(lead[key]).trim()) ? Number(lead[key]).toLocaleString("en-IN") : pdfSafe(lead[key])]);
    if (lead.area) detailRows.push(["Area / locality", pdfSafe(lead.area)]);
    const visitAddress = visitLog.find((v) => v.address)?.address;
    const exactAddress = lead.exactAddress || visitAddress;
    const alreadyShownAsLocation = fields.some(([key]) => key === "propertyLocation") && lead.propertyLocation === exactAddress;
    if (exactAddress && !alreadyShownAsLocation) detailRows.push(["Exact address", pdfSafe(exactAddress)]);
    if (lead.budgetValue) detailRows.push(["Budget (Rs.)", Number(lead.budgetValue).toLocaleString()]);
    if (lead.sqft) detailRows.push(["Size (sqft)", Number(lead.sqft).toLocaleString()]);
    if (lead.followUpDate) detailRows.push(["Next follow-up", formatDate(lead.followUpDate)]);
    Object.entries(parseCustomFields(lead)).forEach(([key, value]) => {
      if (key === "galleryId") return; // internal linkage, not useful in a lead report
      if (value) detailRows.push([prettifyKey(key), pdfSafe(value)]);
    });

    if (detailRows.length) {
      const detailValueW = pageWidth - margin * 2 - 130 - 8;
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        theme: "plain",
        styles: { fontSize: 9, cellPadding: { top: 2, bottom: 2, left: 4, right: 4 }, textColor: [30, 30, 40] },
        columnStyles: {
          0: { fontStyle: "bold", textColor: [110, 110, 120], cellWidth: 130 },
        },
        body: detailRows.map(([label, value]) => [label, richCell(value, detailValueW, { sizePt: 9, pad: 2 })]),
        didDrawCell: drawRichCell(doc),
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    const remarksLog = parseRemarksLog(lead);
    const remarkRows = remarksLog.length
      ? remarksLog.map((rm) => [formatDateTime(rm.at), pdfSafe(rm.by) || "-", richCell(rm.text, pageWidth - margin * 2 - 95 - 70 - 10, { sizePt: 8.5, pad: 5 })])
      : [["-", "-", "No remarks logged yet."]];

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, top: 130 },
      head: [["Date & time", "By", "Remark"]],
      body: remarkRows,
      theme: "striped",
      styles: { fontSize: 8.5, cellPadding: 5, textColor: [30, 30, 40] },
      alternateRowStyles: { fillColor: [250, 246, 239] },
      headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 95 },
        1: { cellWidth: 70 },
      },
      didDrawCell: drawRichCell(doc),
      didDrawPage: () => {
        drawBanner();
      },
    });
    y = doc.lastAutoTable.finalY + 24;

    // Divider between lead cards
    doc.setDrawColor(230, 225, 215);
    doc.setLineWidth(0.5);
    doc.line(margin, y - 12, pageWidth - margin, y - 12);
  }

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(i, totalPages);
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const safeFilter = (filterLabel || "all").toLowerCase().replace(/\s+/g, "-");
  doc.save(`${roleLabel.toLowerCase()}-crm-report-${safeFilter}-${dateStr}.pdf`);
}
