import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist needs browser globals (DOMMatrix) that its own Node polyfills
  // provide only when loaded via native require, not when bundled.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
