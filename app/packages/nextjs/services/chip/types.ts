export type RequestStatus = "pending" | "signed" | "relaying" | "confirmed" | "failed" | "expired";

export type TransferRequest = {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: RequestStatus;
  token: `0x${string}`;
  tokenSymbol: string;
  tokenDecimals: number;
  to: `0x${string}`;
  toName?: string;
  amount: string; // base units, as a decimal string
  amountFormatted: string;
  nonce: string;
  deadline: number; // unix seconds
  digest: `0x${string}`;
  signature?: { r: `0x${string}`; s: `0x${string}` };
  signedAt?: number;
  txHash?: `0x${string}`;
  blockNumber?: string;
  gasUsed?: string;
  relayer?: `0x${string}`;
  error?: string;
};

export type ChipStatus = {
  serial?: string;
  revision?: string;
  configLocked?: boolean;
  dataLocked?: boolean;
  slot?: number;
  hasKey?: boolean;
  note?: string;
};

export type DeviceInfo = {
  name: string;
  backend: string;
  qx?: `0x${string}`; // absent until the chip has a key
  qy?: `0x${string}`;
  firstSeen: number;
  lastSeen: number;
  pairTxHash?: `0x${string}`;
  chip?: ChipStatus;
};

export type CommandType = "status" | "genkey" | "lock-config";

/** A job for the Pi. The browser creates it, the Pi polls, runs it, posts the result. */
export type Command = {
  id: string;
  type: CommandType;
  createdAt: number;
  status: "pending" | "running" | "done" | "failed";
  result?: unknown;
  error?: string;
  doneAt?: number;
};

export type Store = {
  device?: DeviceInfo;
  requests: TransferRequest[];
  commands: Command[];
};
