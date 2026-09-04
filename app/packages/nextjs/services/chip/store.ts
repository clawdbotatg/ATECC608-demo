import { Store, TransferRequest } from "./types";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";

/**
 * Tiny JSON-file queue. One writer (this server), a handful of rows. Lives in .chip/ (gitignored)
 * so it survives Next.js hot reloads and restarts. Not a database — it is a demo.
 */
const FILE = process.env.CHIP_STORE_PATH || join(process.cwd(), ".chip", "store.json");
const MAX_REQUESTS = 200;

let cache: Store | undefined;

export function readStore(): Store {
  if (cache) return cache;
  if (existsSync(FILE)) {
    try {
      cache = JSON.parse(readFileSync(FILE, "utf8")) as Store;
    } catch {
      cache = { requests: [] };
    }
  } else {
    cache = { requests: [] };
  }
  return cache;
}

export function writeStore(store: Store) {
  cache = store;
  mkdirSync(dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, FILE);
}

export function updateStore(fn: (store: Store) => void): Store {
  const store = readStore();
  fn(store);
  store.requests.sort((a, b) => b.createdAt - a.createdAt);
  if (store.requests.length > MAX_REQUESTS) store.requests.length = MAX_REQUESTS;
  writeStore(store);
  return store;
}

export function findRequest(id: string): TransferRequest | undefined {
  return readStore().requests.find(r => r.id === id);
}

export function patchRequest(id: string, patch: Partial<TransferRequest>): TransferRequest {
  let out: TransferRequest | undefined;
  updateStore(store => {
    const r = store.requests.find(x => x.id === id);
    if (!r) throw new Error(`request ${id} not found`);
    Object.assign(r, patch, { updatedAt: Date.now() });
    out = r;
  });
  return out!;
}
