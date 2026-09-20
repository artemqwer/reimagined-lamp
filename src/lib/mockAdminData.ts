// Demo dataset for the admin panel, used while the real database is still being
// built. Toggled from the admin toolbar (see MockDataToggle in admin/page.tsx);
// when on, the users list is filled from here instead of /api/admin/users, so
// the Users table and the Analytics tab (MRR/churn/plan mix all derive from
// `users`) render populated without a backend.
import type { AdminUser, Plan, SubStatus } from "@/app/api/admin/users/route";

const DAY = 86_400_000;
const now = Date.now();

const PRICE: Record<Plan, number> = {
  Free: 0,
  Professional: 199,
  Business: 349,
  Enterprise: 499,
};
const COLORS = ["#059669", "#0ea5e9", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6"];

const CH: Record<string, { label: string; account: string }> = {
  google_ads: { label: "Google Ads", account: "123-456-7890" },
  meta_ads: { label: "Meta Ads", account: "act_889201" },
  ga4: { label: "GA4", account: "properties/337epsilon" },
  shopify: { label: "Shopify", account: "acme.myshopify.com" },
};

const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

function expiryInfo(days: number | null, status: SubStatus) {
  if (days === null)
    return {
      expiry: null,
      expiryLabel: status === "Active" ? "Active" : "—",
      expiryState: "none" as const,
    };
  const iso = new Date(now + days * DAY).toISOString();
  if (days < 0) return { expiry: iso, expiryLabel: "Expired", expiryState: "expired" as const };
  if (days <= 7)
    return {
      expiry: iso,
      expiryLabel: `${days} day${days === 1 ? "" : "s"} left`,
      expiryState: "soon" as const,
    };
  return { expiry: iso, expiryLabel: dateLabel(now + days * DAY), expiryState: "ok" as const };
}

function loginInfo(mins: number) {
  const label =
    mins < 60
      ? `${mins} min ago`
      : mins < 1440
        ? `${Math.floor(mins / 60)}h ago`
        : `${Math.floor(mins / 1440)} day${mins >= 2880 ? "s" : ""} ago`;
  return { lastLogin: label, lastLoginMins: mins };
}

type Seed = {
  name: string;
  email: string;
  company: string;
  phone: string;
  plan: Plan;
  status: SubStatus;
  expiryDays: number | null;
  loginMins: number;
  regDays: number;
  monthsActive: number;
  isAdmin?: boolean;
  connectors?: string[];
};

const SEEDS: Seed[] = [
  { name: "Olena Kravets", email: "olena@brightcart.io", company: "BrightCart", phone: "+1 415 555 0132", plan: "Enterprise", status: "Active", expiryDays: 210, loginMins: 12, regDays: 540, monthsActive: 18, isAdmin: true, connectors: ["google_ads", "meta_ads", "ga4", "shopify"] },
  { name: "Marcus Bell", email: "marcus@northloop.co", company: "NorthLoop", phone: "+1 212 555 0177", plan: "Business", status: "Active", expiryDays: 48, loginMins: 95, regDays: 300, monthsActive: 10, connectors: ["google_ads", "meta_ads"] },
  { name: "Priya Nair", email: "priya@lumen.shop", company: "Lumen", phone: "+44 20 7946 0102", plan: "Professional", status: "Active", expiryDays: 5, loginMins: 40, regDays: 120, monthsActive: 4, connectors: ["shopify", "ga4"] },
  { name: "Tomasz Wójcik", email: "tomasz@dovetail.pl", company: "Dovetail", phone: "+48 22 555 0143", plan: "Business", status: "Trial", expiryDays: 3, loginMins: 1200, regDays: 11, monthsActive: 0, connectors: ["meta_ads"] },
  { name: "Sara Lund", email: "sara@fjordwear.se", company: "FjordWear", phone: "+46 8 555 0190", plan: "Professional", status: "Active", expiryDays: 66, loginMins: 300, regDays: 200, monthsActive: 6, connectors: ["google_ads", "shopify"] },
  { name: "David Chen", email: "david@peakgear.com", company: "PeakGear", phone: "+1 650 555 0164", plan: "Enterprise", status: "Active", expiryDays: 150, loginMins: 8, regDays: 420, monthsActive: 14, connectors: ["google_ads", "meta_ads", "ga4"] },
  { name: "Amara Okafor", email: "amara@vividco.io", company: "VividCo", phone: "+1 305 555 0119", plan: "Professional", status: "Expired", expiryDays: -12, loginMins: 20160, regDays: 260, monthsActive: 5, connectors: ["ga4"] },
  { name: "Luca Ferrari", email: "luca@stellamoda.it", company: "Stella Moda", phone: "+39 06 555 0128", plan: "Business", status: "Active", expiryDays: 90, loginMins: 60, regDays: 340, monthsActive: 11, connectors: ["meta_ads", "shopify"] },
  { name: "Hannah Weber", email: "hannah@grünkraft.de", company: "Grünkraft", phone: "+49 30 555 0155", plan: "Free", status: "Trial", expiryDays: 6, loginMins: 5, regDays: 8, monthsActive: 0, connectors: [] },
  { name: "Ivan Petrenko", email: "ivan@solar.ua", company: "Solar", phone: "+380 44 555 0171", plan: "Enterprise", status: "Expired", expiryDays: -40, loginMins: 86400, regDays: 500, monthsActive: 9, connectors: ["google_ads", "ga4"] },
];

export const MOCK_USERS: AdminUser[] = SEEDS.map((s, i) => {
  const ex = expiryInfo(s.expiryDays, s.status);
  const login = loginInfo(s.loginMins);
  const regMs = now - s.regDays * DAY;
  const connectors = s.connectors ?? [];
  return {
    id: `mock-${i + 1}`,
    name: s.name,
    initials: initials(s.name),
    avatarColor: COLORS[i % COLORS.length],
    avatarUrl: null,
    email: s.email,
    phone: s.phone,
    company: s.company,
    plan: s.plan,
    status: s.status,
    ...ex,
    revenueMonthly: PRICE[s.plan],
    revenueTotal: PRICE[s.plan] * s.monthsActive,
    ...login,
    registered: dateLabel(regMs),
    registeredMs: regMs,
    isAdmin: s.isAdmin ?? false,
    connectors,
    channels: connectors.map((id) => ({ id, ...(CH[id] ?? { label: id, account: "—" }) })),
  };
});
