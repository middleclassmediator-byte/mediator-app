import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { MapPin, Image as ImageIcon, LogOut, Pencil, Search } from "lucide-react";
import CRMBoard from "../components/admin/CRMBoard";
import PropertiesTab from "../components/admin/PropertiesTab";
import CommandCenter from "../components/admin/CommandCenter";
import TodayBoard from "../components/admin/TodayBoard";
import MatchesBoard from "../components/admin/MatchesBoard";
import BroadcastBoard from "../components/admin/BroadcastBoard";
import useAllLeads from "../lib/useAllLeads";
import { buildTasks, leadsToCsv } from "../lib/insights";
import { downloadCsv } from "../lib/exportCsv";
import CommandPalette from "../components/admin/CommandPalette";
import BrandHeader from "../components/wizard/BrandHeader";
import { adminInputCls, btnDark } from "../components/admin/styles";
import { COLORS } from "../lib/theme";
import { adminListMediators, adminListSellers, adminListBuyers } from "../lib/api";

// Same option lists as the public Seller/Buyer/Mediator forms, so admin
// edits use matching dropdowns instead of free-text and can't drift from
// what the forms actually offer.
const PROPERTY_TYPES = ["Home / Independent House", "Apartment / Flat", "Villa", "Plot / Land", "Hotel", "Restaurant", "Saloon", "Shop / Retail", "Office / Commercial Space"];
const PROPERTY_STATUS = ["Brand New", "Resale", "Under Construction"];
const PRICE_RANGES = ["Below ₹30 Lakhs", "₹30–50 Lakhs", "₹50–75 Lakhs", "₹75 Lakhs–₹1 Crore", "Above ₹1 Crore"];
const OWNER_TYPE = ["Direct Owner", "Agent / Broker"];
const SELL_TIMELINE = ["Immediately", "Within 1 Month", "Within 3 Months", "Just Exploring"];
const PHOTOS_SHARED = ["Shared", "Will Share Later"];
const SELLER_PURPOSE = ["Own Use", "Investment"];
const PROPERTY_AGE = ["Less than 1 Year", "1–5 Years", "5–10 Years", "Above 10 Years"];
const BUILDING_TYPE = ["Ground Floor", "G+1", "G+2", "G+3 & Above", "Apartment"];
const FACING = ["North", "South", "East", "West"];
const PROPERTY_USAGE = ["Residential", "Commercial", "Semi-Commercial"];
const PATTA_APPROVAL = ["Online Patta", "CMDA", "DTCP", "Panchayat", "Not Approved"];
const APPROVAL_STATUS = ["Land Approved", "Building Approved", "Both Approved"];
const PARKING = ["Car Parking", "Bike Parking", "Both", "No Parking"];
const RENTAL_STATUS = ["Rented", "Vacant", "Owner Occupied"];
const LOAN_STATUS = ["Loan Running", "Loan Closed", "No Loan"];

const PURPOSE = ["Own Use", "Investment"];
const BUDGET = ["Below ₹30 Lakhs", "₹30–50 Lakhs", "₹50–75 Lakhs", "₹75 Lakhs–₹1 Crore", "Above ₹1 Crore"];
const BUYER_LOCATIONS = ["North Chennai", "Central Chennai", "South Chennai", "No Specific Preference"];
const YES_NO = ["Yes", "No"];
const BUY_TIMELINE = ["Immediately", "Within 1 Month", "Within 3 Months", "Just Exploring"];

const PROFESSIONS = ["Mediator", "Real Estate Agent", "Builder", "Developer"];
const MEDIATOR_AREAS = ["North Chennai", "Central Chennai", "South Chennai", "All Over Chennai"];
const CATEGORIES = ["Residential", "Commercial", "Land", "Rental", "All Categories"];
const EXPERIENCE = ["Below 1 Year", "1–3 Years", "3–5 Years", "Above 5 Years"];
const DEAL_TYPES = ["Sale", "Rental", "Lease", "All"];

// Each role has its own pipeline stages — these aren't the same generic
// New/Contacted/Closed for everyone, they reflect how each role actually
// gets worked. Mediator has a second, independent pipeline on top.
const SELLER_STATUSES = ["New", "Contacted", "Direct Owner", "Agent"];
const BUYER_STATUSES = ["New", "Contacted", "20% to 50%", "50% to 70%", "70% to 100%", "Worthless"];
const MEDIATOR_STATUSES = ["New", "Contacted", "Pending", "Visited"];
const MEDIATOR_STATUSES_2 = ["Worth", "Ok", "Not worth"];

const CRM_CONFIG = {
  seller: {
    label: "Seller",
    accent: COLORS.teal,
    sheet: "Sellers",
    fetcher: adminListSellers,
    statuses: SELLER_STATUSES,
    fields: [
      ["ownership", "Owner type", OWNER_TYPE],
      ["propertyLocation", "Location"],
      ["photosShared", "Photos & videos", PHOTOS_SHARED],
      ["propertyType", "Property type", PROPERTY_TYPES],
      ["purpose", "Purpose", SELLER_PURPOSE],
      ["propertyStatus", "Status", PROPERTY_STATUS],
      ["propertyAge", "Property age", PROPERTY_AGE],
      ["buildingType", "Building type", BUILDING_TYPE],
      ["landArea", "Land area (sqft)"],
      ["builtUpArea", "Built-up area (sqft)"],
      ["frontageLength", "Frontage length (ft)"],
      ["frontageBreadth", "Frontage breadth (ft)"],
      ["roadWidth", "Road width (ft)"],
      ["facing", "Facing", FACING],
      ["propertyUsage", "Property usage", PROPERTY_USAGE],
      ["pattaApproval", "Patta / approval", PATTA_APPROVAL],
      ["approvalStatus", "Approval status", APPROVAL_STATUS],
      ["parking", "Parking", PARKING],
      ["rentalStatus", "Rental status", RENTAL_STATUS],
      ["loanStatus", "Loan status", LOAN_STATUS],
      ["expectedPrice", "Expected price", PRICE_RANGES],
      ["exactPrice", "Exact price (₹)"],
      ["timeline", "Planning to sell", SELL_TIMELINE],
      ["sellerRemarks", "Seller's remarks"],
    ],
    facetFields: [
      ["propertyType", "Property type"],
      ["propertyStatus", "Property status"],
      ["timeline", "Planning to sell"],
      ["facing", "Facing"],
      ["propertyUsage", "Property usage"],
      ["approvalStatus", "Approval status"],
      ["parking", "Parking"],
      ["rentalStatus", "Rental status"],
      ["loanStatus", "Loan status"],
    ],
  },
  buyer: {
    label: "Buyer",
    accent: COLORS.coral,
    sheet: "Buyers",
    fetcher: adminListBuyers,
    statuses: BUYER_STATUSES,
    fields: [
      ["propertyType", "Property type", PROPERTY_TYPES],
      ["purpose", "Purpose", PURPOSE],
      ["budget", "Budget", BUDGET],
      ["preferredLocation", "Preferred location", BUYER_LOCATIONS],
      ["loanRequirement", "Loan requirement", YES_NO],
      ["timeline", "Planning to buy", BUY_TIMELINE],
    ],
    facetFields: [
      ["propertyType", "Property type"],
      ["purpose", "Purpose"],
      ["timeline", "Planning to buy"],
    ],
  },
  mediator: {
    label: "Mediator",
    accent: COLORS.steel,
    sheet: "Mediators",
    fetcher: adminListMediators,
    statuses: MEDIATOR_STATUSES,
    statuses2: MEDIATOR_STATUSES_2,
    status2Label: "Lead quality",
    fields: [
      ["profession", "Profession", PROFESSIONS],
      ["workingArea", "Working area", MEDIATOR_AREAS],
      ["propertyCategory", "Category", CATEGORIES],
      ["experience", "Experience", EXPERIENCE],
      ["dealType", "Deal type", DEAL_TYPES],
      ["genuineLeads", "Genuine leads only", YES_NO],
    ],
    facetFields: [
      ["propertyCategory", "Category"],
      ["profession", "Profession"],
      ["dealType", "Deal type"],
    ],
  },
};

const TABS = [
  { key: "overview", label: "Overview", color: "#C89B3C" },
  { key: "today", label: "Today", color: "#C4503F" },
  { key: "seller", label: "Sellers", color: COLORS.teal },
  { key: "buyer", label: "Buyers", color: COLORS.coral },
  { key: "mediator", label: "Mediators", color: COLORS.steel },
  { key: "matches", label: "Matches", color: "#7A5BB0" },
  { key: "broadcast", label: "Broadcast", color: "#1E9E5A" },
  { key: "properties", label: "Published listings", color: COLORS.sage },
];

// Tabs that read from the shared all-leads fetch rather than fetching on their own.
const INSIGHT_TABS = ["overview", "today", "matches", "broadcast"];

// Pipeline stages per role, handed to the Overview funnels.
const STATUSES_BY_ROLE = {
  seller: SELLER_STATUSES,
  buyer: BUYER_STATUSES,
  mediator: MEDIATOR_STATUSES,
};

const headerLink =
  "h-10 px-3 rounded-full bg-white/10 hover:bg-white/20 text-white text-[12px] font-semibold flex items-center gap-1.5 transition-colors";

export default function AdminDashboard() {
  const [tab, setTab] = useState("overview");
  const [password, setPassword] = useState(null);
  const [adminName, setAdminName] = useState(() => localStorage.getItem("mcm_admin_name") || "");
  const [editingName, setEditingName] = useState(false);
  const navigate = useNavigate();
  const insights = useAllLeads(password);
  const refreshInsights = insights.refresh;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const [jump, setJump] = useState(null); // { tab, id } — open this lead after switching tab

  // Ctrl/⌘+K opens the search & command palette from anywhere in the dashboard.
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openLead(role, id) {
    setJump({ tab: role, id });
    setTab(role);
  }

  // Edits made in the Sellers/Buyers/Mediators boards, so re-sync whenever
  // the person comes back to one of the insight views.
  useEffect(() => {
    if (INSIGHT_TABS.includes(tab)) refreshInsights();
  }, [tab, refreshInsights]);

  const urgentCount = useMemo(() => {
    if (insights.loading) return 0;
    return buildTasks(insights.data).filter((t) => t.bucket === "overdue" || t.bucket === "today").length;
  }, [insights.data, insights.loading]);

  useEffect(() => {
    const pw = sessionStorage.getItem("mcm_admin_pw");
    if (!pw) {
      navigate("/control");
      return;
    }
    setPassword(pw);
  }, [navigate]);

  // Arriving from the call-notes page with ?find=<number> opens search on that number.
  const findParam = params.get("find");
  useEffect(() => {
    if (!findParam || !password) return;
    setPaletteQuery(findParam);
    setPaletteOpen(true);
    setParams({}, { replace: true });
  }, [findParam, password, setParams]);

  useEffect(() => {
    if (!adminName) setEditingName(true);
  }, [adminName]);

  function saveName(value) {
    const trimmed = value.trim();
    setAdminName(trimmed);
    localStorage.setItem("mcm_admin_name", trimmed);
    setEditingName(false);
  }

  function logout() {
    sessionStorage.removeItem("mcm_admin_pw");
    navigate("/control");
  }

  if (!password) return null;

  const paletteActions = [
    { id: "refresh", label: "Refresh all data", run: refreshInsights },
    { id: "csv-seller", label: "Export sellers to CSV", run: () => downloadCsv(`mcm-sellers-${new Date().toISOString().slice(0, 10)}.csv`, leadsToCsv("seller", insights.data.seller || [])) },
    { id: "csv-buyer", label: "Export buyers to CSV", run: () => downloadCsv(`mcm-buyers-${new Date().toISOString().slice(0, 10)}.csv`, leadsToCsv("buyer", insights.data.buyer || [])) },
    { id: "broadcast", label: "Send a bulk WhatsApp message", run: () => setTab("broadcast") },
    { id: "quick", label: "Quick call notes", run: () => navigate("/quick") },
    { id: "field", label: "New field visit", run: () => navigate("/control/field-visit") },
    { id: "gallery", label: "Open buyer gallery", run: () => navigate("/gallery") },
    { id: "logout", label: "Log out", run: logout },
  ];

  const active = CRM_CONFIG[tab];
  const tabColor = TABS.find((t) => t.key === tab)?.color || COLORS.teal;

  return (
    <div className="min-h-screen bg-canvas" style={{ "--accent": tabColor }}>
      <BrandHeader
        color={tabColor}
        wide
        right={
          <nav className="flex items-center gap-2" aria-label="Admin shortcuts">
            <Link to="/control/field-visit" className={headerLink} aria-label="Field visit page">
              <MapPin size={15} />
              <span className="hidden sm:inline">Field visit</span>
            </Link>
            <Link to="/gallery" className={headerLink} aria-label="Buyer gallery">
              <ImageIcon size={15} />
              <span className="hidden sm:inline">Gallery</span>
            </Link>
            <button onClick={logout} className={headerLink} aria-label="Log out">
              <LogOut size={15} />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </nav>
        }
      />

      <div className="max-w-6xl mx-auto px-5 pt-6 pb-24">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display font-bold text-[1.7rem] leading-tight text-ink">Command center</h1>
            {!editingName && (
              <button
                onClick={() => setEditingName(true)}
                className="mt-1 text-sm text-ink/60 hover:text-ink flex items-center gap-1.5"
                title="Change the name shown on remarks you add"
              >
                Signed in as <span className="font-semibold text-ink/85">{adminName}</span>
                <Pencil size={12} />
              </button>
            )}
          </div>
          <button
            onClick={() => setPaletteOpen(true)}
            className="h-11 pl-4 pr-3 rounded-full bg-surface border border-ink/15 hover:border-ink/40 text-[13px] text-ink/60 flex items-center gap-3 transition-colors"
            aria-label="Search leads and commands"
          >
            <Search size={15} />
            <span className="hidden sm:inline">Search leads…</span>
            <kbd className="hidden sm:block text-[10.5px] font-bold text-ink/45 border border-ink/15 rounded-md px-1.5 py-0.5">Ctrl K</kbd>
          </button>
        </div>

        {editingName && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveName(e.target.elements.name.value);
            }}
            className="mt-4 rounded-2xl bg-surface border border-ink/10 p-4 flex flex-col sm:flex-row sm:items-end gap-3"
          >
            <div className="flex-1">
              <label htmlFor="admin-name" className="block text-[11px] font-bold uppercase tracking-wider text-ink/55 mb-1.5">
                Your name
              </label>
              <input
                id="admin-name"
                name="name"
                autoFocus
                defaultValue={adminName}
                placeholder="Shown next to the remarks you add"
                className={adminInputCls}
              />
            </div>
            <button type="submit" className={`${btnDark} sm:w-32`}>Save</button>
          </form>
        )}

        <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar pb-1" role="tablist" aria-label="Admin sections">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={on}
                onClick={() => { setTab(t.key); setJump(null); }}
                className={`shrink-0 h-11 px-5 rounded-full text-[14px] font-semibold border flex items-center gap-2 transition-colors ${
                  on ? "bg-ink text-white border-ink" : "bg-surface text-ink/70 border-ink/15 hover:border-ink/40"
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: on ? "#fff" : t.color }} />
                {t.label}
                {t.key === "today" && urgentCount > 0 && (
                  <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center ${on ? "bg-white text-ink" : "bg-coral text-white"}`}>
                    {urgentCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          {tab === "overview" && (
            <CommandCenter
              {...insights}
              adminName={adminName}
              statusesByRole={STATUSES_BY_ROLE}
              onNavigate={setTab}
              onOpenLead={openLead}
            />
          )}
          {tab === "today" && <TodayBoard {...insights} password={password} adminName={adminName} />}
          {tab === "matches" && <MatchesBoard {...insights} adminName={adminName} />}
          {tab === "broadcast" && (
            <BroadcastBoard {...insights} adminName={adminName} password={password} />
          )}
          {active && (
            <CRMBoard
              key={tab}
              type={tab}
              label={active.label}
              accent={active.accent}
              sheet={active.sheet}
              fetcher={active.fetcher}
              fields={active.fields}
              facetFields={active.facetFields}
              statuses={active.statuses}
              statuses2={active.statuses2}
              status2Label={active.status2Label}
              password={password}
              adminName={adminName}
              initialOpenId={jump && jump.tab === tab ? jump.id : null}
              onOpenHandled={() => setJump(null)}
            />
          )}
          {tab === "properties" && <PropertiesTab password={password} />}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => { setPaletteOpen(false); setPaletteQuery(""); }}
        initialQuery={paletteQuery}
        data={{ seller: insights.data.seller || [], buyer: insights.data.buyer || [], mediator: insights.data.mediator || [] }}
        tabs={TABS}
        actions={paletteActions}
        onGo={(k) => { setTab(k); setJump(null); }}
        onOpenLead={openLead}
      />
    </div>
  );
}
