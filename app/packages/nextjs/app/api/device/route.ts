import { NextRequest, NextResponse } from "next/server";
import { isHex } from "viem";
import { isLocal, relayerAddress } from "~~/services/chip/chain";
import { admin, onchainSigner, setSigner } from "~~/services/chip/relay";
import { readStore, updateStore } from "~~/services/chip/store";
import { DeviceInfo } from "~~/services/chip/types";

export const dynamic = "force-dynamic";

const isBytes32 = (v: unknown): v is `0x${string}` => typeof v === "string" && isHex(v) && v.length === 66;

/** The Pi calls this on boot (and every 30 s) with its chip public key. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { qx, qy } = body;
  if (!isBytes32(qx) || !isBytes32(qy)) {
    return NextResponse.json({ error: "qx and qy must be 0x-prefixed 32-byte hex" }, { status: 400 });
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 64) : "device";
  const backend = typeof body.backend === "string" ? body.backend.slice(0, 32) : "unknown";

  const now = Date.now();
  let device: DeviceInfo | undefined;
  updateStore(store => {
    const prev = store.device;
    const sameKey = prev && prev.qx.toLowerCase() === qx.toLowerCase() && prev.qy.toLowerCase() === qy.toLowerCase();
    device = {
      name,
      backend,
      qx,
      qy,
      firstSeen: sameKey ? prev!.firstSeen : now,
      lastSeen: now,
      pairTxHash: sameKey ? prev!.pairTxHash : undefined,
    };
    store.device = device;
  });

  // Pair onchain if the contract does not already trust this key.
  const onchain = await onchainSigner();
  const matches = onchain.qx.toLowerCase() === qx.toLowerCase() && onchain.qy.toLowerCase() === qy.toLowerCase();
  if (matches) return NextResponse.json({ paired: true, device, relayer: relayerAddress() });

  const adminAddr = await admin();
  if (adminAddr.toLowerCase() !== relayerAddress().toLowerCase()) {
    return NextResponse.json({
      paired: false,
      device,
      error: `contract admin is ${adminAddr}, relay is ${relayerAddress()} — call setSigner(qx, qy) from the admin (or set CHIP_PUBKEY_X/Y and redeploy)`,
    });
  }
  try {
    const txHash = await setSigner(qx, qy);
    updateStore(store => {
      if (store.device) store.device.pairTxHash = txHash;
    });
    return NextResponse.json({ paired: true, txHash, device, relayer: relayerAddress(), isLocal });
  } catch (e: any) {
    return NextResponse.json(
      { paired: false, device, error: e?.shortMessage || e?.message || String(e) },
      { status: 500 },
    );
  }
}

export async function GET() {
  const { device } = readStore();
  const onchain = await onchainSigner().catch(() => undefined);
  const matches =
    !!device &&
    !!onchain &&
    onchain.qx.toLowerCase() === device.qx.toLowerCase() &&
    onchain.qy.toLowerCase() === device.qy.toLowerCase();
  return NextResponse.json({ device, onchain, paired: matches });
}
