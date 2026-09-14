import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getApplicationOrganisationState } from "@/lib/production/server";
import { Providers } from "./providers";
import { Sidebar } from "@/components/dashboard/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Waste Screening Portal",
  description: "Upload a lab report or describe your waste stream to find out how it classifies and which partner network can process it.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const organisation = await getApplicationOrganisationState();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex">
        <Providers organisation={organisation}>
          <Sidebar />
          <main className="flex-1 min-w-0">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
