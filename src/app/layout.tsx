import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Same fallback the OAuth routes use, so a preview deploy without the env var
// set still resolves absolute metadata URLs instead of failing the build.
const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.datarocks.net";

const TITLE = "MetricForge — E-commerce Intelligence";
const DESCRIPTION =
  "Spend, revenue and ROAS across Google Ads, Meta, GA4 and Shopify in one dashboard — with an AI analyst that answers in plain English.";

export const metadata: Metadata = {
  // Required for the relative opengraph-image/icon URLs below to resolve to
  // absolute ones — social crawlers reject relative image paths.
  metadataBase: new URL(siteUrl),
  title: {
    default: TITLE,
    // Per-source dashboards set their own title; this keeps the brand on it.
    template: "%s · MetricForge",
  },
  description: DESCRIPTION,
  applicationName: "MetricForge",
  openGraph: {
    type: "website",
    siteName: "MetricForge",
    title: TITLE,
    description: DESCRIPTION,
    url: siteUrl,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} antialiased`}>
      <body className="bg-[#f9fafb]">{children}</body>
    </html>
  );
}
