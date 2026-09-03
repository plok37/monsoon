import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Monsoon",
  description:
    "Disciplined ETH insurance underwriting on Thetanuts. Premiums arrive with the storm.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('monsoon-theme');if(t==='dark')document.documentElement.dataset.theme='dark'}catch(e){}",
          }}
        />
        <Providers>
          <Nav />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-line">
            <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-faint flex flex-wrap gap-x-6 gap-y-1 items-center justify-between">
              <span>Monsoon. Built on Thetanuts, Base mainnet.</span>
              <span>Options carry risk of loss. This is a hackathon prototype, not financial advice.</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
