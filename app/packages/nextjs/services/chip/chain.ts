import { relayerKeyFromKeystore } from "./keystore";
import {
  type Address,
  Chain,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import deployedContracts from "~~/contracts/deployedContracts";
import scaffoldConfig from "~~/scaffold.config";
import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";
import { getAlchemyHttpUrl } from "~~/utils/scaffold-eth/networks";

/**
 * Server-side chain access for the relay. Everything here runs in Next.js route handlers only.
 *
 * Relay account:
 *   - live chains: RELAYER_KEYSTORE=<foundry keystore name> (+ password) in .env.local — preferred,
 *                  the key stays encrypted on disk. RELAYER_PRIVATE_KEY also works.
 *   - localhost:   no key at all. Anvil's dev accounts are unlocked, so we send eth_sendTransaction
 *                  from account #9 — the same account `yarn deploy` uses, so it is also the ChipAccount
 *                  admin and can pair the chip's key automatically.
 */
const LOCAL_CHAIN_ID = 31337;
const ANVIL_DEPLOYER: Address = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"; // anvil account #9 (SE2 default deployer)

export const targetChain: Chain = scaffoldConfig.targetNetworks[0];
export const isLocal = targetChain.id === LOCAL_CHAIN_ID;

function rpcUrl(): string {
  if (isLocal) return process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545";
  const override = (scaffoldConfig.rpcOverrides as Record<number, string> | undefined)?.[targetChain.id];
  return (
    process.env.RELAY_RPC_URL || override || getAlchemyHttpUrl(targetChain.id) || targetChain.rpcUrls.default.http[0]
  );
}

let _public: PublicClient | undefined;
export function publicClient(): PublicClient {
  if (!_public) _public = createPublicClient({ chain: targetChain, transport: http(rpcUrl()) });
  return _public;
}

let _wallet: WalletClient | undefined;
export function relayClient(): WalletClient {
  if (_wallet) return _wallet;
  const pk = process.env.RELAYER_PRIVATE_KEY || relayerKeyFromKeystore();
  if (pk) {
    _wallet = createWalletClient({
      chain: targetChain,
      transport: http(rpcUrl()),
      account: privateKeyToAccount(pk as `0x${string}`),
    });
  } else if (isLocal) {
    _wallet = createWalletClient({ chain: targetChain, transport: http(rpcUrl()), account: ANVIL_DEPLOYER });
  } else {
    throw new Error(
      "RELAYER_PRIVATE_KEY is not set (packages/nextjs/.env.local) — the relay has no account to pay gas with",
    );
  }
  return _wallet;
}

export function relayerAddress(): Address {
  return relayClient().account!.address;
}

type Deployed = { address: Address; abi: readonly unknown[] };
function deployed(name: string): Deployed | undefined {
  const byChain = (deployedContracts as GenericContractsDeclaration)[targetChain.id];
  const c = byChain?.[name];
  return c ? { address: getAddress(c.address), abi: c.abi } : undefined;
}

export function chipAccount(): Deployed {
  const c = deployed("ChipAccount");
  if (!c) throw new Error(`ChipAccount is not deployed on chain ${targetChain.id} — run yarn deploy`);
  return c;
}

export function tokenAddress(): Address {
  const env = process.env.USDS_ADDRESS || process.env.NEXT_PUBLIC_USDS_ADDRESS;
  if (env) return getAddress(env);
  const mock = deployed("MockUSDS");
  if (!mock) throw new Error("No token: set USDS_ADDRESS, or run yarn deploy on localhost for MockUSDS");
  return mock.address;
}

let _tokenMeta: { symbol: string; decimals: number; address: Address } | undefined;
export async function tokenMeta() {
  const address = tokenAddress();
  if (_tokenMeta && _tokenMeta.address === address) return _tokenMeta;
  const pc = publicClient();
  const [symbol, decimals] = await Promise.all([
    pc.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    pc.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  _tokenMeta = { symbol, decimals, address };
  return _tokenMeta;
}

export async function tokenBalance(owner: Address): Promise<bigint> {
  return publicClient().readContract({
    address: tokenAddress(),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}
