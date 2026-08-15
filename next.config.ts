import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist needs browser globals (DOMMatrix) that its own Node polyfills
  // provide only when loaded via native require, not when bundled.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  // workerSrc references pdf.worker.mjs by string path, invisible to file tracing.
  outputFileTracingIncludes: {
    "/api/extract*": ["./node_modules/pdfjs-dist/legacy/build/**"],
  },
};

export default nextConfig;
