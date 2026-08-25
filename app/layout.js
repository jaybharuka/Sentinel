import { Source_Serif_4, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Runs before hydration (strategy="beforeInteractive") so the "dark" class
// is already on <html> by first paint - defaults to light when nothing is
// stored, per the light-by-default requirement for first-time visitors.
const THEME_INIT_SCRIPT = `
try {
  if (localStorage.getItem("sentinel_theme") === "dark") {
    document.documentElement.classList.add("dark");
  }
} catch (e) {}
`;

// Editorial warmth for headings, like Claude's own interface - Source
// Serif 4 rather than Anthropic's proprietary display face, to keep this
// a real, freely-licensed Google Font (no IP/trademark risk).
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata = {
  title: "Sentinel: Fraud & Chargeback Risk Guard",
  description:
    "Explainable, bounded, gated fraud risk detection for online merchants.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${sourceSerif.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        {children}
      </body>
    </html>
  );
}
