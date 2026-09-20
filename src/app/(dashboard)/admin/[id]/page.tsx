"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { AdminUser } from "@/app/api/admin/users/route";

const usd = (n: number | undefined | null) => `$${(n ?? 0).toLocaleString("en-US")}`;

// ─── Inline icons (stroke = currentColor, sized via width/height) ────────────
type IconProps = { size?: number; className?: string };
const I = (p: { size?: number; className?: string; children: React.ReactNode }) => (
  <svg
    width={p.size ?? 16}
    height={p.size ?? 16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={p.className}
  >
    {p.children}
  </svg>
);
const ArrowLeft = (p: IconProps) => (
  <I {...p}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </I>
);
const Pencil = (p: IconProps) => (
  <I {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </I>
);
const Eye = (p: IconProps) => (
  <I {...p}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </I>
);
const Mail = (p: IconProps) => (
  <I {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2 7 10 7 10-7" />
  </I>
);
const Phone = (p: IconProps) => (
  <I {...p}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.59 1.2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6.29 6.29l.87-.87a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </I>
);
const Calendar = (p: IconProps) => (
  <I {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </I>
);
const Clock = (p: IconProps) => (
  <I {...p}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </I>
);
const CheckCircle = (p: IconProps) => (
  <I {...p}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </I>
);
const DollarSign = (p: IconProps) => (
  <I {...p}>
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </I>
);
const CreditCard = (p: IconProps) => (
  <I {...p}>
    <rect x="1" y="4" width="22" height="16" rx="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </I>
);
const Activity = (p: IconProps) => (
  <I {...p}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </I>
);
const Megaphone = (p: IconProps) => (
  <I {...p}>
    <path d="m3 11 18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </I>
);
const LogIn = (p: IconProps) => (
  <I {...p}>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <polyline points="10 17 15 12 10 7" />
    <line x1="15" y1="12" x2="3" y2="12" />
  </I>
);
const PlusCircle = (p: IconProps) => (
  <I {...p}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </I>
);

// Presentation only — the connected channels themselves come from the API
// (AdminUser.channels), keyed by connector id. Colour + sub-label per platform.
const CHANNEL_STYLE: Record<string, { grad: string; kind: string }> = {
  google_ads: { grad: "linear-gradient(135deg,#2b7fff,#059669)", kind: "Advertising Platform" },
  meta_ads: { grad: "linear-gradient(135deg,#ad46ff,#9810fa)", kind: "Social Media Platform" },
  ga4: { grad: "linear-gradient(135deg,#f59e0b,#e8710a)", kind: "Web Analytics" },
  microsoft_ads: { grad: "linear-gradient(135deg,#ff6900,#f54900)", kind: "Advertising Platform" },
  google_search_console: {
    grad: "linear-gradient(135deg,#22c55e,#16a34a)",
    kind: "Search Analytics",
  },
  shopify: { grad: "linear-gradient(135deg,#22c55e,#16a34a)", kind: "E-commerce Platform" },
};
const channelStyle = (id: string) =>
  CHANNEL_STYLE[id] ?? { grad: "linear-gradient(135deg,#64748b,#475569)", kind: "Data Source" };

function StatusBadge({ status }: { status: AdminUser["status"] }) {
  const map = {
    Active: { bg: "#dcfce7", fg: "#008236", icon: <CheckCircle size={16} /> },
    Trial: { bg: "#fef9c3", fg: "#a16207", icon: <Clock size={16} /> },
    Expired: { bg: "#fee2e2", fg: "#dc2626", icon: <Clock size={16} /> },
  } as const;
  const s = map[status] ?? map.Active;
  return (
    <span
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[10px] text-[14px] font-medium"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.icon}
      {status}
    </span>
  );
}

export default function AdminUserDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"overview" | "billing" | "activity">("overview");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/admin/users");
        const json = (await res.json()) as { users?: AdminUser[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to load");
        const found = (json.users ?? []).find((u) => u.id === id) ?? null;
        if (!alive) return;
        if (!found) setError("User not found");
        setUser(found);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="p-4 sm:p-6 flex items-center justify-center min-h-[60vh]">
        <div className="w-7 h-7 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="p-4 sm:p-6">
        <button
          onClick={() => router.push("/admin")}
          className="inline-flex items-center gap-2 text-[14px] text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={18} /> Back to User Management
        </button>
        <div className="bg-white border border-gray-100 rounded-[10px] p-10 text-center text-gray-400 text-[14px]">
          {error || "User not found"}
        </div>
      </div>
    );
  }

  const company = user.company || "—";
  const STATS = [
    {
      value: `${usd(user.revenueMonthly)}/mo`,
      label: "Monthly Revenue",
      bg: "#dcfce7",
      fg: "#008236",
      icon: <DollarSign size={24} />,
    },
    {
      value: usd(user.revenueTotal),
      label: "Total Paid",
      bg: "#f3e8ff",
      fg: "#8200db",
      icon: <CreditCard size={24} />,
    },
    {
      value: String(user.channels.length),
      label: "Connected Channels",
      bg: "#dbeafe",
      fg: "#059669",
      icon: <Activity size={24} />,
    },
  ];
  // Real account events — only what we actually record: the last sign-in and the
  // registration. The fabricated login-IP / campaign / payment rows they replaced
  // were pure placeholder.
  const ACTIVITY = [
    {
      icon: <LogIn size={16} />,
      fg: "#059669",
      title: "Last login",
      desc: user.lastLogin === "Never" ? "Has not signed in yet" : `Signed in ${user.lastLogin}`,
      time: user.lastLogin,
    },
    {
      icon: <PlusCircle size={16} />,
      fg: "#008236",
      title: "Account created",
      desc: `Registered on ${user.registered}`,
      time: user.registered,
    },
  ];
  const FIELDS = [
    { label: "Email", value: user.email, icon: <Mail size={20} /> },
    { label: "Phone", value: user.phone || "—", icon: <Phone size={20} /> },
    { label: "Registered", value: user.registered, icon: <Calendar size={20} /> },
    { label: "Last Login", value: user.lastLogin, icon: <Clock size={20} /> },
  ];

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-6 text-[#101828]">
      {/* ── Header bar ── */}
      <div className="bg-white border border-[#e5e7eb] rounded-[10px] p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/admin")}
              className="w-10 h-10 rounded-[10px] bg-[#f3f4f6] hover:bg-gray-200 flex items-center justify-center text-[#101828] transition shrink-0"
            >
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-[20px] font-bold leading-[28px]">User Details</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/admin?edit=${user.id}`)}
              className="inline-flex items-center gap-2 h-[41px] px-4 rounded-[10px] border border-[#d1d5dc] bg-white text-[16px] text-[#364153] hover:bg-gray-50 transition"
            >
              <Pencil size={16} /> Edit
            </button>
            <button
              onClick={() => {
                // Hand the target off to the dashboard, which reads it back and
                // sends it as view_as on every data fetch (the API re-scopes to
                // this user's connected account after checking we may see them).
                try {
                  sessionStorage.setItem("dr_view_as", user.id);
                  sessionStorage.setItem("dr_view_as_name", user.name);
                  // The client's OWN connected sources, so the sidebar shows their
                  // platforms (they may have Meta while the admin doesn't, etc.).
                  sessionStorage.setItem("dr_view_as_connectors", JSON.stringify(user.connectors));
                } catch {
                  /* private mode — the dashboard just opens on your own data */
                }
                router.push("/google-ads");
              }}
              className="inline-flex items-center gap-2 h-[41px] px-4 rounded-[10px] bg-[#059669] hover:bg-emerald-700 text-white text-[16px] transition"
            >
              <Eye size={16} /> View as Client
            </button>
          </div>
        </div>
      </div>

      {/* ── Identity card ── */}
      <div className="bg-white border border-[#e5e7eb] rounded-[10px] overflow-hidden">
        <div
          className="h-16 w-full"
          style={{ background: "linear-gradient(to right,#2b7fff,#ad46ff,#f6339a)" }}
        />
        <div className="px-6 pb-6 flex flex-col gap-6">
          {/* avatar + name (avatar overlaps banner) */}
          <div className="flex items-end -mt-8">
            <div
              className="w-24 h-24 rounded-[14px] border-4 border-white p-1 flex items-center justify-center shrink-0 overflow-hidden shadow-[0px_10px_7.5px_rgba(0,0,0,0.1),0px_4px_3px_rgba(0,0,0,0.1)]"
              style={{ background: "linear-gradient(135deg,#2b7fff,#9810fa)" }}
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover rounded-[10px]"
                />
              ) : (
                <span className="text-[24px] leading-[32px] font-bold text-white">
                  {user.initials}
                </span>
              )}
            </div>
            <div className="ml-4 pb-1">
              <p className="text-[24px] leading-[32px] font-bold text-[#101828]">{user.name}</p>
              <p className="text-[16px] leading-[24px] text-[#4a5565]">{company}</p>
            </div>
          </div>

          {/* fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-4">
            {FIELDS.map((f) => (
              <div key={f.label} className="flex items-center gap-3">
                <span className="text-[#6a7282] shrink-0">{f.icon}</span>
                <div className="min-w-0">
                  <p className="text-[12px] leading-[16px] text-[#6a7282]">{f.label}</p>
                  <p className="text-[14px] leading-[20px] text-[#101828] truncate">{f.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* badges */}
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={user.status} />
            <span
              className="inline-flex items-center h-8 px-3 rounded-[10px] text-[14px] font-medium"
              style={{ background: "#f3e8ff", color: "#8200db" }}
            >
              {user.plan} Plan
            </span>
          </div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {STATS.map((s) => (
          <div key={s.label} className="bg-white border border-[#e5e7eb] rounded-[10px] p-5">
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-[10px] flex items-center justify-center shrink-0"
                style={{ background: s.bg, color: s.fg }}
              >
                {s.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[24px] leading-[32px] font-bold text-[#101828] truncate">
                  {s.value}
                </p>
                <p className="text-[14px] leading-[20px] text-[#4a5565]">{s.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Tabbed content ── */}
      <div className="bg-white border border-[#e5e7eb] rounded-[10px] overflow-hidden">
        {/* tabs */}
        <div className="flex border-b border-[#e5e7eb]">
          {(
            [
              ["overview", "Overview"],
              ["billing", "Billing History"],
              ["activity", "Activity Log"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`h-[54px] px-[22px] text-[14px] font-medium border-b-2 -mb-px transition ${tab === key ? "border-[#059669] text-[#059669]" : "border-transparent text-[#6a7282] hover:text-gray-700"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === "overview" && (
            <div className="flex flex-col gap-6">
              {/* Connected Channels */}
              <div className="flex flex-col gap-4">
                <h3 className="text-[18px] leading-[28px] font-semibold text-[#101828]">
                  Connected Channels
                </h3>
                {user.channels.length === 0 ? (
                  <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-[14px] py-8 text-center text-[14px] text-[#6a7282]">
                    No data sources connected yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {user.channels.map((ch) => {
                      const st = channelStyle(ch.id);
                      return (
                        <div
                          key={ch.id}
                          className="bg-white border border-[#e5e7eb] rounded-[14px] p-5 flex flex-col gap-4"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className="w-12 h-12 rounded-[10px] flex items-center justify-center shrink-0 text-white"
                                style={{ background: st.grad }}
                              >
                                <Megaphone size={24} />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[16px] leading-[24px] font-semibold text-[#101828] truncate">
                                  {ch.label}
                                </p>
                                <p className="text-[12px] leading-[16px] text-[#6a7282]">
                                  {st.kind}
                                </p>
                              </div>
                            </div>
                            <span
                              className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[12px] font-medium shrink-0"
                              style={{ background: "#dcfce7", color: "#008236" }}
                            >
                              <CheckCircle size={12} /> Active
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[#4a5565]">
                            <span className="text-[#6a7282] shrink-0">
                              <Activity size={16} />
                            </span>
                            <span className="text-[14px] leading-[20px] truncate">
                              {ch.account}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent Activity */}
              <div className="flex flex-col gap-4">
                <h3 className="text-[18px] leading-[28px] font-semibold text-[#101828]">
                  Recent Activity
                </h3>
                <div className="flex flex-col gap-3">
                  {ACTIVITY.map((a, i) => (
                    <div
                      key={i}
                      className="bg-[#f9fafb] rounded-[10px] h-[62px] px-3 flex items-center gap-3"
                    >
                      <span className="shrink-0 mt-0.5" style={{ color: a.fg }}>
                        {a.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] leading-[20px] font-medium text-[#101828]">
                          {a.title}
                        </p>
                        <p className="text-[12px] leading-[16px] text-[#4a5565] truncate">
                          {a.desc}
                        </p>
                      </div>
                      <span className="text-[12px] leading-[16px] text-[#6a7282] shrink-0 whitespace-nowrap">
                        {a.time}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "billing" && (
            <div className="py-10 text-center text-[14px] text-gray-400">
              Billing history will appear here.
            </div>
          )}
          {tab === "activity" && (
            <div className="flex flex-col gap-3">
              {ACTIVITY.map((a, i) => (
                <div
                  key={i}
                  className="bg-[#f9fafb] rounded-[10px] h-[62px] px-3 flex items-center gap-3"
                >
                  <span className="shrink-0 mt-0.5" style={{ color: a.fg }}>
                    {a.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] leading-[20px] font-medium text-[#101828]">
                      {a.title}
                    </p>
                    <p className="text-[12px] leading-[16px] text-[#4a5565] truncate">{a.desc}</p>
                  </div>
                  <span className="text-[12px] leading-[16px] text-[#6a7282] shrink-0 whitespace-nowrap">
                    {a.time}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Suspend ── */}
      <div className="flex justify-center pt-1 pb-2">
        <button className="text-[14px] text-[#e7000b] underline hover:text-red-700 transition">
          Suspend Account
        </button>
      </div>
    </div>
  );
}
