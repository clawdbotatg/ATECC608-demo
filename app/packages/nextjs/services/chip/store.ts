import { targetChain } from "./chain";
import { Command, Store, TransferRequest } from "./types";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import deployedContracts from "~~/contracts/deployedContracts";
import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

/**
 * Tiny JSON-file queue. One writer (this server), a handful of rows. Lives in .chip/ (gitignored)
 * so it survives Next.js hot reloads and restarts. Not a database — it is a demo.
 *
 * One file per (chain id, ChipAccount address), so the list you see is only ever this deployment's:
 * switching from localhost to mainnet (or redeploying) starts a fresh queue.
 */
function storeFile(): string {
  if (process.env.CHIP_STORE_PATH) return process.env.CHIP_STORE_PATH;
  const addr = (deployedContracts as GenericContractsDeclaration)[targetChain.id]?.ChipAccount?.address ?? "undeployed";
  return join(process.cwd(), ".chip", `store-${targetChain.id}-${addr.toLowerCase()}.json`);
}
const FILE = storeFile();
const MAX_REQUESTS = 200;

let cache: Store | undefined;

export function readStore(): Store {
  if (cache) return cache;
  if (existsSync(FILE)) {
    try {
      cache = JSON.parse(readFileSync(FILE, "utf8")) as Store;
      cache.commands ??= [];
    } catch {
      cache = { requests: [], commands: [] };
    }
  } else {
    cache = { requests: [], commands: [] };
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
  store.commands.sort((a, b) => b.createdAt - a.createdAt);
  if (store.commands.length > 50) store.commands.length = 50;
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

export function patchCommand(id: string, patch: Partial<Command>): Command {
  let out: Command | undefined;
  updateStore(store => {
    const c = store.commands.find(x => x.id === id);
    if (!c) throw new Error(`command ${id} not found`);
    Object.assign(c, patch);
    out = c;
  });
  return out!;
}
