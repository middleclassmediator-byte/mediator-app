import Wizard from "../components/wizard/Wizard";
import ChoiceGroup from "../components/wizard/ChoiceGroup";
import TextField, { PhoneField } from "../components/wizard/TextField";
import { isValidPhone } from "../lib/validate";
import { COLORS } from "../lib/theme";
import { addSellerLead } from "../lib/api";
import { whatsappLink } from "../lib/whatsapp";
import { MEDIATOR_WHATSAPP_NUMBER } from "../lib/config";

const PROPERTY_TYPES = ["Home / Independent House", "Apartment / Flat", "Villa", "Plot / Land", "Hotel", "Restaurant", "Saloon", "Shop / Retail", "Office / Commercial Space"];
const PROPERTY_STATUS = ["Brand New", "Resale", "Under Construction"];
const PRICE_RANGES = ["Below ₹30 Lakhs", "₹30–50 Lakhs", "₹50–75 Lakhs", "₹75 Lakhs–₹1 Crore", "Above ₹1 Crore"];
const OWNER_TYPE = ["Direct Owner", "Agent / Broker"];
const TIMELINE = ["Immediately", "Within 1 Month", "Within 3 Months", "Just Exploring"];
const PHOTOS_SHARED = ["Shared", "Will Share Later"];
const PURPOSE = ["Own Use", "Investment"];
const PROPERTY_AGE = ["Less than 1 Year", "1–5 Years", "5–10 Years", "Above 10 Years"];
const BUILDING_TYPE = ["Ground Floor", "G+1", "G+2", "G+3 & Above", "Apartment"];
const ROAD_WIDTH = ["20 Feet", "24 Feet", "30 Feet", "40 Feet & Above"];
const FACING = ["North", "South", "East", "West"];
const PROPERTY_USAGE = ["Residential", "Commercial", "Semi-Commercial"];
const PATTA_APPROVAL = ["Online Patta", "CMDA", "DTCP", "Panchayat", "Not Approved"];
const APPROVAL_STATUS = ["Land Approved", "Building Approved", "Both Approved"];
const PARKING = ["Car Parking", "Bike Parking", "Both", "No Parking"];
const RENTAL_STATUS = ["Rented", "Vacant", "Owner Occupied"];
const LOAN_STATUS = ["Loan Running", "Loan Closed", "No Loan"];

const initialForm = {
  name: "", phone: "",
  ownership: "", propertyLocation: "", photosShared: "",
  propertyType: "", purpose: "", propertyStatus: "", propertyAge: "", buildingType: "",
  landArea: "", builtUpArea: "", frontageLength: "", frontageBreadth: "",
  roadWidth: "", facing: "", propertyUsage: "", pattaApproval: "", approvalStatus: "",
  parking: "", rentalStatus: "", loanStatus: "",
  expectedPrice: "", timeline: "", sellerRemarks: "",
};

const landing = {
  title: "Selling a property in Chennai?",
  subtitle: "List it with us and we'll connect you with genuine buyers.",
  note: "Only the starred questions are required. Add more detail later in the form if you like.",
  cta: "Get started",
  items: [
    { label: "You", text: "Who you are and how to reach you", color: COLORS.steel },
    { label: "Property", text: "Type, location, status, price and timing", color: COLORS.teal },
    { label: "Extra details", text: "Optional: size, approvals, parking. They make your listing stronger", color: COLORS.coral },
  ],
};

function NumberField({ label, placeholder, value, onChange, className = "" }) {
  return (
    <TextField
      className={className}
      label={label}
      type="number"
      inputMode="decimal"
      min="0"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// Optional details that make a listing easier for buyers to trust.
const BOOST_KEYS = ["propertyAge", "purpose", "photosShared", "buildingType", "propertyUsage", "landArea", "builtUpArea", "frontageLength", "roadWidth", "facing", "pattaApproval", "approvalStatus", "parking", "rentalStatus", "loanStatus", "sellerRemarks"];

function ListingStrength({ form }) {
  const filled = BOOST_KEYS.filter((k) => String(form[k] ?? "").trim() !== "" || (k === "frontageLength" && form.frontageBreadth)).length;
  const pct = Math.round(50 + (filled / BOOST_KEYS.length) * 50);
  const label = pct < 60 ? "Basic listing" : pct < 80 ? "Good listing" : pct < 95 ? "Strong listing" : "Complete listing";
  return (
    <div className="mb-6 rounded-2xl bg-[#F7F5F1] ring-1 ring-ink/[0.06] p-4" role="status" aria-label={`Listing strength ${pct} percent`}>
      <div className="flex items-baseline justify-between">
        <span className="font-display font-bold text-[1.05rem] text-ink">{label}</span>
        <span className="font-display font-bold text-[1.25rem] tabular-nums" style={{ color: "var(--accent)" }}>{pct}%</span>
      </div>
      <div className="mt-2.5 h-2 rounded-full bg-ink/[0.08] overflow-hidden">
        <span className="progress-fill block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: "var(--accent)" }} />
      </div>
      <p className="mt-2.5 text-[12.5px] text-ink/55 leading-snug">Fuller listings answer buyers' questions before they ask. Every detail you add lifts this.</p>
    </div>
  );
}

const steps = [
  {
    label: "About you",
    title: "Tell us who you are",
    hint: "The mediator will message you on WhatsApp.",
    valid: (f) => f.ownership && f.name.trim() && isValidPhone(f.phone),
    render: (f, set) => (
      <>
        <ChoiceGroup label="Are you the property owner?" required options={OWNER_TYPE} value={f.ownership} onChange={(v) => set("ownership", v)} />
        <div className="mt-7">
          <TextField label="Full name" required valid={f.name.trim().length > 1} autoComplete="name" placeholder="Your name" value={f.name} onChange={(e) => set("name", e.target.value)} />
          <PhoneField value={f.phone} onChange={(v) => set("phone", v)} />
        </div>
      </>
    ),
  },
  {
    label: "The property",
    title: "What are you selling, and where?",
    auto: false,
    valid: (f) => f.propertyType && f.propertyLocation.trim(),
    render: (f, set) => (
      <>
        <ChoiceGroup label="Property type" required options={PROPERTY_TYPES} value={f.propertyType} onChange={(v) => set("propertyType", v)} />
        <div className="mt-7">
          <TextField label="Area / locality" required valid={f.propertyLocation.trim().length > 2} placeholder="e.g. Ambattur, Anna Nagar" value={f.propertyLocation} onChange={(e) => set("propertyLocation", e.target.value)} />
        </div>
        <ChoiceGroup label="Photos and videos" options={PHOTOS_SHARED} value={f.photosShared} onChange={(v) => set("photosShared", v)} />
      </>
    ),
  },
  {
    label: "Status and age",
    title: "Status and age",
    valid: (f) => f.propertyStatus,
    render: (f, set) => (
      <>
        <ChoiceGroup label="Property status" required options={PROPERTY_STATUS} value={f.propertyStatus} onChange={(v) => set("propertyStatus", v)} />
        <ChoiceGroup label="Property age" options={PROPERTY_AGE} value={f.propertyAge} onChange={(v) => set("propertyAge", v)} />
        <ChoiceGroup label="Purpose" options={PURPOSE} value={f.purpose} onChange={(v) => set("purpose", v)} />
      </>
    ),
  },
  {
    label: "Price and timing",
    title: "Price and timing",
    hint: "That's everything we need. After this you can add more detail, or finish.",
    valid: (f) => f.expectedPrice && f.timeline,
    render: (f, set) => (
      <>
        <ChoiceGroup label="Expected price" required options={PRICE_RANGES} value={f.expectedPrice} onChange={(v) => set("expectedPrice", v)} />
        <ChoiceGroup label="When are you planning to sell?" required options={TIMELINE} value={f.timeline} onChange={(v) => set("timeline", v)} />
      </>
    ),
  },
  {
    label: "Building and size",
    title: "About the building and its size",
    hint: "Buyers filter by size, so this gets you seen.",
    optional: true,
    valid: () => true,
    render: (f, set) => (
      <>
        <ListingStrength form={f} />
        <ChoiceGroup label="Building type" options={BUILDING_TYPE} value={f.buildingType} onChange={(v) => set("buildingType", v)} />
        <ChoiceGroup label="Property usage" options={PROPERTY_USAGE} value={f.propertyUsage} onChange={(v) => set("propertyUsage", v)} />
        <div className="mt-7">
          <NumberField label="Land area (sq.ft)" placeholder="e.g. 1200" value={f.landArea} onChange={(v) => set("landArea", v)} />
          <NumberField label="Built-up area (sq.ft)" placeholder="e.g. 1800" value={f.builtUpArea} onChange={(v) => set("builtUpArea", v)} />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <NumberField className="!mt-0" label="Frontage length (ft)" placeholder="Length" value={f.frontageLength} onChange={(v) => set("frontageLength", v)} />
            <NumberField className="!mt-0" label="Frontage breadth (ft)" placeholder="Breadth" value={f.frontageBreadth} onChange={(v) => set("frontageBreadth", v)} />
          </div>
        </div>
      </>
    ),
  },
  {
    label: "Road and approvals",
    title: "Road, facing and approvals",
    hint: "Approvals are the first thing serious buyers ask about.",
    optional: true,
    valid: () => true,
    render: (f, set) => (
      <>
        <ListingStrength form={f} />
        <ChoiceGroup label="Road width" options={ROAD_WIDTH} value={f.roadWidth} onChange={(v) => set("roadWidth", v)} />
        <ChoiceGroup label="Facing" options={FACING} value={f.facing} onChange={(v) => set("facing", v)} />
        <ChoiceGroup label="Patta / approval" options={PATTA_APPROVAL} value={f.pattaApproval} onChange={(v) => set("pattaApproval", v)} />
        <ChoiceGroup label="Approval status" options={APPROVAL_STATUS} value={f.approvalStatus} onChange={(v) => set("approvalStatus", v)} />
      </>
    ),
  },
  {
    label: "Parking, loan and notes",
    title: "Parking, rental, loan and anything else",
    optional: true,
    valid: () => true,
    render: (f, set) => (
      <>
        <ListingStrength form={f} />
        <ChoiceGroup label="Parking" options={PARKING} value={f.parking} onChange={(v) => set("parking", v)} />
        <ChoiceGroup label="Rental status" options={RENTAL_STATUS} value={f.rentalStatus} onChange={(v) => set("rentalStatus", v)} />
        <ChoiceGroup label="Loan status" options={LOAN_STATUS} value={f.loanStatus} onChange={(v) => set("loanStatus", v)} />
        <div className="mt-7">
          <TextField
            label="Anything else buyers should know?"
            multiline
            placeholder="e.g. corner plot, near the metro, owner relocating"
            value={f.sellerRemarks}
            onChange={(e) => set("sellerRemarks", e.target.value)}
          />
        </div>
      </>
    ),
  },
];

const short = (t) => (t ? t.split(" / ")[0] : "");
const first = (n) => n.trim().split(" ")[0];

export default function Seller() {
  return (
    <Wizard
      role="Seller"
      initialForm={initialForm}
      landing={landing}
      steps={steps}
      reviewTitle="Review your listing"
      reviewNote="Check everything looks right. Tap any row to change it."
      chips={(f) => [f.name.trim() && first(f.name), short(f.propertyType), f.propertyLocation.trim(), f.propertyStatus, f.expectedPrice]}
      reviewRows={(f) => [
        { label: "Owner type", value: f.ownership, step: 1 },
        { label: "Name", value: f.name, step: 1 },
        { label: "Mobile", value: f.phone, step: 1 },
        { label: "Property", value: f.propertyType, step: 2 },
        { label: "Location", value: f.propertyLocation, step: 2 },
        { label: "Photos", value: f.photosShared, step: 2 },
        { label: "Status", value: f.propertyStatus, step: 3 },
        { label: "Age", value: f.propertyAge, step: 3 },
        { label: "Purpose", value: f.purpose, step: 3 },
        { label: "Price", value: f.expectedPrice, step: 4 },
        { label: "Timeline", value: f.timeline, step: 4 },
        { label: "Building", value: f.buildingType, step: 5 },
        { label: "Usage", value: f.propertyUsage, step: 5 },
        { label: "Land area", value: f.landArea ? `${f.landArea} sq.ft` : "", step: 5 },
        { label: "Built-up", value: f.builtUpArea ? `${f.builtUpArea} sq.ft` : "", step: 5 },
        { label: "Frontage", value: f.frontageLength || f.frontageBreadth ? `${f.frontageLength || "–"} × ${f.frontageBreadth || "–"} ft` : "", step: 5 },
        { label: "Road width", value: f.roadWidth, step: 6 },
        { label: "Facing", value: f.facing, step: 6 },
        { label: "Patta", value: f.pattaApproval, step: 6 },
        { label: "Approval", value: f.approvalStatus, step: 6 },
        { label: "Parking", value: f.parking, step: 7 },
        { label: "Rental", value: f.rentalStatus, step: 7 },
        { label: "Loan", value: f.loanStatus, step: 7 },
        { label: "Remarks", value: f.sellerRemarks.trim(), step: 7 },
      ]}
      submit={(f) => addSellerLead({ ...f, name: f.name.trim(), propertyLocation: f.propertyLocation.trim() })}
      submitLabel="Submit listing"
      success={{
        title: "Your listing is in",
        text: (f) =>
          `We've saved your listing in ${f.propertyLocation.trim()}. As the seller, you can message the mediator directly on WhatsApp. They'll follow up with you personally.`,
        next: [
          { title: "Our team reviews your listing", text: "A person reads every submission before anything is shared." },
          { title: "The mediator messages you on WhatsApp", text: "Share photos, confirm details and agree the price range." },
          { title: "Your property reaches genuine buyers", text: "Approved listings can appear in the property gallery." },
        ],
        primary: (f) => ({
          label: "Message the mediator on WhatsApp",
          href: whatsappLink(
            MEDIATOR_WHATSAPP_NUMBER,
            `New seller registration — ${f.propertyType}\n` +
              `From: ${f.name} (${f.phone})\n` +
              `Location: ${f.propertyLocation}\n` +
              `Status: ${f.propertyStatus}\n` +
              `Expected price: ${f.expectedPrice}\n` +
              `Ownership: ${f.ownership}\n` +
              `Planning to sell: ${f.timeline}`
          ),
        }),
        againLabel: "List another property",
      }}
    />
  );
}
