// Stores the raw bytes of an uploaded lab report, keyed by case id, in IndexedDB — separate
// from lib/projects.ts's cases-v1 localStorage blob, since localStorage's low quota (~5-10MB
// total, one JSON blob per key) would risk filling up fast with real PDF-sized files and would
// bloat every read/write of the whole case list. Falls back to an in-memory Map when IndexedDB
// isn't available (SSR, Node test environment), mirroring lib/projects.ts's hasStorage() pattern
// for localStorage, so this stays genuinely unit testable without a real browser.
const DB_NAME = "waste-portal-reports";
const DB_VERSION = 1;
const STORE_NAME = "reports";

const memory = new Map<string, File>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveReportFile(caseId: string, file: File): Promise<void> {
  if (!hasIndexedDb()) {
    memory.set(caseId, file);
    return;
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(file, caseId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getReportFile(caseId: string): Promise<File | null> {
  if (!hasIndexedDb()) {
    return memory.get(caseId) ?? null;
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(caseId);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}
