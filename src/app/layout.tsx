import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "MyFinance",
    template: "%s · MyFinance",
  },
  description: "Kişisel finans yönetimi — hesaplar, kartlar, taksitler ve analiz",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "MyFinance",
    statusBarStyle: "black-translucent",
  },
  // Kişisel ve gizli veri; arama motorlarına asla açılmamalı.
  robots: { index: false, follow: false, nocache: true },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
};

/**
 * Tema, sayfa boyanmadan önce uygulanır; aksi halde koyu temada
 * bir anlık beyaz ekran parlaması olur.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('myfinance-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (stored !== 'light' && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
