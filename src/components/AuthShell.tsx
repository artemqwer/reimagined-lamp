import BrandLogo from "@/components/BrandLogo";

// Split-screen auth shell: brand story on the left, form on the right.
// Collapses to a single centered column on phones.
const FEATURES = [
  {
    title: "Every source, one view",
    body: "Google Ads, Meta, GA4 and Shopify blended into a single revenue picture.",
  },
  {
    title: "AI analyst included",
    body: "Ask questions in plain English — get answers grounded in your own numbers.",
  },
  {
    title: "Goals that watch themselves",
    body: "Smart Goals flag anomalies the moment a metric drifts off plan.",
  },
];

export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      {/* Brand panel */}
      <aside className="hidden lg:flex w-[44%] max-w-[640px] shrink-0 relative overflow-hidden flex-col justify-between border-r border-zinc-800/80 bg-[linear-gradient(165deg,#04110c_0%,#0b0b0d_55%,#09090b_100%)]">
        <div
          aria-hidden
          className="absolute -top-44 -left-44 w-[560px] h-[560px] rounded-full bg-emerald-500/10 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute bottom-[-160px] right-[-120px] w-[420px] h-[420px] rounded-full bg-emerald-500/5 blur-3xl"
        />
        {/* Anvil grid: faint dot matrix */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        <div className="relative p-10">
          <BrandLogo />
        </div>

        <div className="relative px-10 pb-8">
          <h2 className="text-[26px] font-bold text-zinc-100 leading-tight max-w-[380px]">
            Know exactly where the money goes.
          </h2>
          <p className="mt-2 text-[14px] text-zinc-500 max-w-[380px]">
            Spend, revenue and ROAS for your whole store — without stitching five exports together.
          </p>
          <ul className="mt-8 space-y-5">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3.5 max-w-[400px]">
                <span className="mt-0.5 shrink-0 w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-[var(--brand-fg)]">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-zinc-200">{f.title}</p>
                  <p className="text-[13px] text-zinc-500 leading-snug">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative px-10 pb-6 text-[11px] text-zinc-600">
          © {new Date().getFullYear()} MetricForge
        </p>
      </aside>

      {/* Form column */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10 pb-safe">
        <div className="lg:hidden mb-6">
          <BrandLogo />
        </div>
        <div className="w-full flex flex-col items-center">{children}</div>
      </main>
    </div>
  );
}
