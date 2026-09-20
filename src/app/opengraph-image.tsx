import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The card that unfurls when a MetricForge link is pasted into Slack, LinkedIn,
// iMessage, X … Generated rather than committed as a PNG so the copy and the
// brand colours stay editable in one place. The lockup uses the SAME
// public/metricforge-logo.png the favicon and the sidebar render, so the card
// cannot drift from the logo. No request-time APIs are used, so Next prerenders
// it at build time and social crawlers are served a static file.

export const alt = "MetricForge — every ad channel in one dashboard";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Inter, subset to printable ASCII (~29 KB a weight). Satori only ships a
// regular-weight fallback, so the bold wordmark needs a real 700 face. Read off
// disk rather than `fetch(new URL(…, import.meta.url))` — Turbopack doesn't
// implement that asset form, and `process.cwd()` is the documented way.
const font = (weight: 400 | 700) => readFile(join(process.cwd(), "assets", `inter-${weight}.ttf`));

// Satori has no filesystem, so the logo is inlined as a data URI. Same file the
// app serves at /metricforge-logo.png — read at build time, not fetched.
const logo = async () =>
  `data:image/png;base64,${(await readFile(join(process.cwd(), "public", "metricforge-logo.png"))).toString("base64")}`;

const BLUE = "#3B82F6";
const CONNECTORS = ["Google Ads", "Meta Ads", "GA4", "Shopify"];

// The mark's bar rhythm, reused for both the logo tile and the backdrop.
const BARS = [
  { h: 8, o: 0.8 },
  { h: 13, o: 0.8 },
  { h: 18, o: 1 },
  { h: 10, o: 0.6 },
];

export default async function OpengraphImage() {
  const [interRegular, interBold, logoSrc] = await Promise.all([font(400), font(700), logo()]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        backgroundColor: "#0A1020",
        backgroundImage:
          "radial-gradient(900px 620px at 88% 8%, rgba(59,130,246,0.30), transparent 70%)," +
          "radial-gradient(700px 500px at 4% 96%, rgba(29,78,216,0.24), transparent 70%)",
        fontFamily: "Inter",
        color: "#FFFFFF",
      }}
    >
      {/* Abstract bar motif bleeding off the right edge, used as wallpaper so
            the card still reads as a analytics product at thumbnail size where
            the body copy is illegible. Decoration only — the logo itself is the
            lockup below. */}
      <div
        style={{
          position: "absolute",
          right: -40,
          bottom: -60,
          display: "flex",
          alignItems: "flex-end",
          gap: 26,
        }}
      >
        {BARS.map((bar, i) => (
          <div
            key={i}
            style={{
              width: 96,
              height: bar.h * 24,
              borderRadius: 30,
              backgroundColor: BLUE,
              opacity: bar.o * 0.13,
            }}
          />
        ))}
      </div>

      {/* ── Lockup ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        {/* The logo is a solid #0070F0 on transparency, so it needs a light
            ground to sit on — against this near-black card it would otherwise
            read as a low-contrast smudge. */}
        <div
          style={{
            width: 76,
            height: 76,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 17,
            backgroundColor: "#FFFFFF",
          }}
        >
          {}
          <img src={logoSrc} width={54} height={54} alt="" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ fontSize: 31, fontWeight: 700, letterSpacing: "0.17em" }}>METRICFORGE</div>
          <div
            style={{
              fontSize: 14,
              letterSpacing: "0.3em",
              color: "#7FA6EE",
            }}
          >
            E-COMMERCE INTELLIGENCE
          </div>
        </div>
      </div>

      {/* ── Message ── */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 78, fontWeight: 700, letterSpacing: "-0.03em" }}>
          Every ad channel.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 78,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#7FB0FF",
            marginTop: 4,
          }}
        >
          One dashboard.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 27,
            lineHeight: 1.45,
            color: "#94A3B8",
            marginTop: 26,
            maxWidth: 830,
          }}
        >
          Spend, revenue and ROAS across every source — with an AI analyst that answers in plain
          English.
        </div>
      </div>

      {/* ── Connectors ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {CONNECTORS.map((name) => (
          <div
            key={name}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "11px 22px",
              borderRadius: 999,
              fontSize: 21,
              color: "#C7D6EE",
              backgroundColor: "rgba(148,180,246,0.10)",
              border: "1px solid rgba(148,180,246,0.22)",
            }}
          >
            {name}
          </div>
        ))}
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Inter", data: interRegular, weight: 400, style: "normal" },
        { name: "Inter", data: interBold, weight: 700, style: "normal" },
      ],
    },
  );
}
