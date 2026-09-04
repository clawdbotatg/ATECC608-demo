import type { DeviceInfo, TransferRequest } from "~~/services/chip/types";

export type AppState = {
  chain: { id: number; name: string; isLocal: boolean };
  account: {
    address: `0x${string}`;
    nonce: string;
    signer: { qx: `0x${string}`; qy: `0x${string}`; paired: boolean };
    balance: string;
    balanceFormatted: string;
  };
  token: { address: `0x${string}`; symbol: string; decimals: number };
  relayer: { address: `0x${string}`; balanceFormatted: string };
  device?: DeviceInfo & { paired: boolean };
  requests: TransferRequest[];
  now: number;
};

export const short = (hex?: string, n = 6) => (hex ? `${hex.slice(0, 2 + n)}…${hex.slice(-n)}` : "");
export const usd = (amount: string | number) =>
  `~$${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const ago = (ts: number, now: number) => {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};
