# v4 — Seller admin tools + professional customer PDF

1. **Property age, Patta / approval, Rental status** — each now has an "Other (type manually)" choice next to the list. A typed value is kept and reopens in the typing box. Rental status also gained **Owner Occupied** (admin and the public seller form).
2. **Floor plan / sketch** — upload it in the seller's detail sheet (new "Floor plan / sketch" section). On the property page it shows as a small thumbnail in the corner of the photo (tap to enlarge) and it is included in the customer PDF. After uploading, tap "Update on gallery" to publish it to a live listing.
3. **Expected price card** — a small box at the top to type the exact amount, plus a live big figure with a slider and ±5L / ±1L / ±10K buttons. It writes the existing Exact price field, and shows whether it is inside the seller's range.
4. **Copy link and Download PDF** are now on the seller card itself (outside "Open details"). "Copy link" says "Share first" if the property isn't on the gallery yet.
5. **Customer PDF redesigned** — branded header, price card, cropped (never stretched) photos, key-facts grid, floor plan, seller's remark in a highlighted box that flows across pages, and a WhatsApp contact card with page numbers.
6. **PDF fixes** — photos no longer glitch (every image is re-encoded as a proper JPEG); remarks keep their line breaks; the rupee sign, Tamil and other non-English text render correctly in both the customer PDF and the admin report.

No Apps Script change is needed: the floor plan is stored inside existing sheet columns.

Files: src/lib/pdfImage.js (new), src/lib/report.js, src/components/admin/PriceAdjustCard.jsx (new), src/components/admin/ui.jsx, src/components/admin/CRMBoard.jsx, src/pages/PropertyDetail.jsx, src/lib/gallery.js, src/pages/AdminDashboard.jsx, src/pages/Seller.jsx.
Verified: npm run build OK, lint clean, tested in a real browser (card buttons, price card, manual fields, floor plan, PDFs with Tamil text and long remarks).

---

# v3 — Admin "Broadcast" tab (bulk WhatsApp messages)

New tab in the admin dashboard: Overview · Today · Sellers · Buyers · Mediators · Matches · **Broadcast** · Published listings.

1. **Who** — Everyone / Buyers / Sellers / Mediators, then filter by Stage, Area, lead heat (Hot/Warm/Cold), property type, "registered in last 7/30/90 days", or search. Duplicate phone numbers are merged; closed leads are skipped by default.
2. **What** — starter templates + your own saved templates. Fields filled per person: {{first_name}} {{name}} {{area}} {{property_type}} {{budget}} {{sender}} and (from your Dispatch Console) {{greeting}} {{date}} {{time}}. Live WhatsApp-style preview.
3. **Send** — one big button: opens WhatsApp with the personalised message ready, you tap Send, come back, tap again. Progress bar, per-person Send / undo, tick/untick anyone.

Safety: people who already got the same message in the last 7 days are un-ticked automatically; warns above 40 recipients; optionally moves "New" leads to "Contacted" after sending.
Also: Copy numbers, Download CSV, and "Dispatch Console files" (numbers.json + message.txt in your console's format).

Files: src/lib/broadcast.js (new), src/components/admin/BroadcastBoard.jsx (new), src/pages/AdminDashboard.jsx (tab + shortcut added).
Verified: npm run build OK, no new lint warnings, tested end-to-end in a browser (desktop + mobile) with mock leads.
