import { NextRequest, NextResponse } from "next/server";
import { formatUnits, parseUnits } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";
import {
  chipAccount,
  isLocal,
  publicClient,
  relayClient,
  targetChain,
  tokenBalance,
  tokenMeta,
} from "~~/services/chip/chain";
import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

export const dynamic = "force-dynamic";

/** Browser, localhost only: mint play USDS into the vault. On live chains send real tokens to the vault address. */
export async function POST(req: NextRequest) {
  if (!isLocal)
    return NextResponse.json(
      { error: "minting only works on localhost; send tokens to the vault address instead" },
      { status: 400 },
    );
  const body = await req.json().catch(() => ({}));
  const amount = typeof body.amount === "string" ? body.amount.trim() : "10";
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0)
    return NextResponse.json({ error: "bad amount" }, { status: 400 });

  const mock = (deployedContracts as GenericContractsDeclaration)[targetChain.id]?.MockUSDS;
  if (!mock) return NextResponse.json({ error: "MockUSDS not deployed" }, { status: 400 });
  const token = await tokenMeta();
  const { address: vault } = chipAccount();
  const wallet = relayClient();
  try {
    const hash = await wallet.writeContract({
      chain: targetChain,
      account: wallet.account!,
      address: mock.address,
      abi: mock.abi,
      functionName: "mint",
      args: [vault, parseUnits(amount, token.decimals)],
    });
    await publicClient().waitForTransactionReceipt({ hash });
    const balance = await tokenBalance(vault);
    return NextResponse.json({ txHash: hash, balanceFormatted: formatUnits(balance, token.decimals) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.shortMessage || e?.message || String(e) }, { status: 500 });
  }
}
