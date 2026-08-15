// pdfjs-dist polyfills DOMMatrix/ImageData/Path2D via a dynamic require that
// serverless file tracing can't see, so @napi-rs/canvas never ships to Vercel.
// A static import guarantees it's traced, and sets the globals before pdfjs loads.
import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";

for (const [name, impl] of Object.entries({ DOMMatrix, ImageData, Path2D })) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any)[name] ??= impl;
}
