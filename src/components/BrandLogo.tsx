export default function BrandLogo() {
  return (
    <div className="flex items-center gap-3 mb-6">
      {/* The current brand logo — the same asset the dashboard sidebar uses, so
          the auth screens match the app (the old hand-drawn SVG bars are gone). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/data-rocks-logo.png"
        alt="MetricForge"
        width={42}
        height={42}
        className="object-contain shrink-0"
      />

      <div>
        <div
          className="text-[16px] font-black leading-tight"
          style={{ letterSpacing: "0.12em", color: "var(--brand-fg)" }}
        >
          METRICFORGE
        </div>
        <div
          className="text-[10.5px] text-gray-400 leading-tight mt-[1px]"
          style={{ letterSpacing: "0.03em" }}
        >
          E-commerce Intelligence
        </div>
      </div>
    </div>
  );
}
