// Browser-canvas helpers for the PDF generators.
//
// Why this exists: jsPDF's built-in fonts only cover basic Latin, and
// jsPDF.addImage needs the image format to match the data. That caused
// three visible problems in the old PDFs:
//   1. photos stretched/squashed (they were forced into a fixed box),
//   2. broken or blank photos when Cloudinary served WebP/PNG while the
//      PDF was told "JPEG",
//   3. remarks losing line breaks, and ₹ / Tamil / emoji turning to junk.
// Everything here goes through <canvas>, which the browser already knows how
// to draw correctly, and is handed to jsPDF as a clean JPEG/PNG.

const SCALE = 3; // canvas pixels per PDF point — keeps text crisp when printed
const FONT_FAMILY = "'Inter', 'Segoe UI', 'Noto Sans Tamil', 'Nirmala UI', 'Latha', system-ui, sans-serif";

/** True when jsPDF's core fonts can't draw this string (₹, Tamil, emoji…). */
export function needsCanvasText(text) {
  return /[\u0100-\uFFFF]/.test(String(text ?? ""));
}

/** Loads any image URL the browser can decode. Never throws — returns null. */
export async function loadImage(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = objectUrl;
      await img.decode();
      return img;
    } finally {
      // The decoded bitmap stays valid after the URL is released.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  } catch {
    return null;
  }
}

function roundedClip(ctx, w, h, r) {
  if (!r) return;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
  ctx.clip();
}

/**
 * Fills a wPt×hPt box with the photo, cropping the overflow (like CSS
 * object-fit: cover) so it is never stretched. Returns a JPEG data URL.
 */
export function coverJpeg(img, wPt, hPt, radiusPt = 0) {
  const w = Math.round(wPt * SCALE);
  const h = Math.round(hPt * SCALE);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  roundedClip(ctx, w, h, radiusPt * SCALE);
  const ratio = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * ratio;
  const dh = img.naturalHeight * ratio;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
  return canvas.toDataURL("image/jpeg", 0.88);
}

/**
 * Fits the WHOLE image inside maxW×maxH (like object-fit: contain) — used for
 * floor plans, where cropping would cut off rooms. Returns the data URL and
 * the size in points it should be drawn at.
 */
export function containPng(img, maxWPt, maxHPt) {
  const ratio = Math.min(maxWPt / img.naturalWidth, maxHPt / img.naturalHeight, 1.5);
  const wPt = img.naturalWidth * ratio;
  const hPt = img.naturalHeight * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(wPt * SCALE);
  canvas.height = Math.round(hPt * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.92), wPt, hPt };
}

function fontString({ sizePt, weight = 400, italic = false }) {
  return `${italic ? "italic " : ""}${weight} ${sizePt * SCALE}px ${FONT_FAMILY}`;
}

/** Word-wraps text to a width (in points), keeping the writer's line breaks. */
export function wrapText(text, { widthPt, sizePt, weight = 400, italic = false }) {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = fontString({ sizePt, weight, italic });
  const maxPx = widthPt * SCALE;
  const lines = [];
  String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push(""); // a blank line the writer left on purpose
        return;
      }
      let line = "";
      words.forEach((word) => {
        const attempt = line ? `${line} ${word}` : word;
        if (ctx.measureText(attempt).width <= maxPx) {
          line = attempt;
          return;
        }
        if (line) lines.push(line);
        // A single very long word (a URL, say) is broken by character.
        if (ctx.measureText(word).width > maxPx) {
          let chunk = "";
          for (const ch of word) {
            if (ctx.measureText(chunk + ch).width > maxPx) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else {
          line = word;
        }
      });
      lines.push(line);
    });
  // Trim blank lines at the very start/end only.
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Draws already-wrapped lines to a transparent PNG. */
export function linesImage(lines, { widthPt, sizePt, color = "#1E1E28", weight = 400, italic = false, lineHeightPt }) {
  const lh = lineHeightPt || sizePt * 1.45;
  const hPt = Math.max(lines.length, 1) * lh;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthPt * SCALE);
  canvas.height = Math.round(hPt * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.font = fontString({ sizePt, weight, italic });
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  lines.forEach((ln, i) => {
    ctx.fillText(ln, 0, (i + 0.5) * lh * SCALE);
  });
  return { dataUrl: canvas.toDataURL("image/png"), wPt: widthPt, hPt, lineHeightPt: lh };
}

/** One-liner: wrap + draw. Handy for short values (price, labels). */
export function textImage(text, opts) {
  const lines = wrapText(text, opts);
  return { lines, ...linesImage(lines, opts) };
}

/** Width in points a single line of text would need (for pills, etc.). */
export function measureText(text, { sizePt, weight = 400, italic = false }) {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = fontString({ sizePt, weight, italic });
  return ctx.measureText(String(text ?? "")).width / SCALE;
}
