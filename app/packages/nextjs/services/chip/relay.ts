import { chipAccount, isLocal, publicClient, relayClient, relayerAddress, targetChain } from "./chain";
import { type Address, type Hex } from "viem";

/**
 * The relay: submits chip-signed transfers and pays the gas. It holds no tokens and cannot spend
 * the vault by itself — a bad relay can only refuse to relay.
 */

export const P256_N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

/** OpenZeppelin's verifier rejects high-s. (r, N-s) is the same signature in canonical form. */
export function normalizeLowS(s: Hex): Hex {
  const v = BigInt(s);
  const canon = v > P256_N / 2n ? P256_N - v : v;
  return `0x${canon.toString(16).padStart(64, "0")}`;
}

export async function onchainSigner(): Promise<{ qx: Hex; qy: Hex; paired: boolean }> {
  const { address, abi } = chipAccount();
  const [qx, qy] = (await publicClient().readContract({ address, abi, functionName: "signer" })) as [Hex, Hex];
  const paired = BigInt(qx) !== 0n || BigInt(qy) !== 0n;
  return { qx, qy, paired };
}

export async function onchainNonce(): Promise<bigint> {
  const { address, abi } = chipAccount();
  return (await publicClient().readContract({ address, abi, functionName: "nonce" })) as bigint;
}

export async function contractDigest(
  token: Address,
  to: Address,
  amount: bigint,
  nonce: bigint,
  deadline: bigint,
): Promise<Hex> {
  const { address, abi } = chipAccount();
  return (await publicClient().readContract({
    address,
    abi,
    functionName: "hashTransfer",
    args: [token, to, amount, nonce, deadline],
  })) as Hex;
}

export async function isValidTransfer(token: Address, to: Address, amount: bigint, deadline: bigint, r: Hex, s: Hex) {
  const { address, abi } = chipAccount();
  return (await publicClient().readContract({
    address,
    abi,
    functionName: "isValidTransfer",
    args: [token, to, amount, deadline, r, s],
  })) as boolean;
}

export async function admin(): Promise<Address> {
  const { address, abi } = chipAccount();
  return (await publicClient().readContract({ address, abi, functionName: "admin" })) as Address;
}

/** Pair the chip key onchain. Only works when the relay is the ChipAccount admin (true on localhost). */
export async function setSigner(qx: Hex, qy: Hex): Promise<Hex> {
  const { address, abi } = chipAccount();
  const wallet = relayClient();
  const hash = await wallet.writeContract({
    chain: targetChain,
    account: wallet.account!,
    address,
    abi,
    functionName: "setSigner",
    args: [qx, qy],
  });
  await publicClient().waitForTransactionReceipt({ hash });
  return hash;
}

export async function executeTransfer(token: Address, to: Address, amount: bigint, deadline: bigint, r: Hex, s: Hex) {
  const { address, abi } = chipAccount();
  const wallet = relayClient();
  const pc = publicClient();
  const args = [token, to, amount, deadline, r, s] as const;
  // simulate first so a revert surfaces as a readable error instead of a burned tx
  await pc.simulateContract({ address, abi, functionName: "executeTransfer", args, account: wallet.account! });
  const hash = await wallet.writeContract({
    chain: targetChain,
    account: wallet.account!,
    address,
    abi,
    functionName: "executeTransfer",
    args,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash });
  return { hash, receipt, relayer: relayerAddress() };
}

export async function relayerBalance(): Promise<bigint> {
  return publicClient().getBalance({ address: relayerAddress() });
}

export { isLocal, relayerAddress };
