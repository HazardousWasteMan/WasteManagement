// pdf.js needs its worker served from a stable URL. Copying it from node_modules at dev/build
// time (rather than committing a vendored copy) keeps it in lockstep with the installed
// pdfjs-dist version — a stale worker fails with a confusing version-mismatch error.
import fs from "node:fs";
const SRC = "node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
const DEST = "public/pdf.worker.min.mjs";
fs.copyFileSync(SRC, DEST);
console.log(`copied ${SRC} -> ${DEST}`);
