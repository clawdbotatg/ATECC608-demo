import { NextRequest, NextResponse } from "next/server";
import { isHex } from "viem";
import { relayerAddress } from "~~/services/chip/chain";
import { onchainSigner } from "~~/services/chip/relay";
import { readStore, updateStore } from "~~/services/chip/store";
import { ChipStatus, DeviceInfo } from "~~/services/chip/types";

export const dynamic = "force-dynamic";

const isBytes32 = (v: unknown): v is `0x${string}` => typeof v === "string" && isHex(v) && v.length === 66;

function sameKey(a?: { qx?: string; qy?: string }, b?: { qx?: string; qy?: string }) {
  return (
    !!a?.qx && !!b?.qx && a.qx.toLowerCase() === b.qx!.toLowerCase() && a.qy!.toLowerCase() === b.qy!.toLowerCase()
  );
}

/** The Pi calls this on boot and every 30 s: "here is my key (if any) and my chip status". */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const hasKey = isBytes32(body.qx) && isBytes32(body.qy);
  if ((body.qx || body.qy) && !hasKey) {
    return NextResponse.json({ error: "qx and qy must be 0x-prefixed 32-byte hex" }, { status: 400 });
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 64) : "device";
  const backend = typeof body.backend === "string" ? body.backend.slice(0, 32) : "unknown";
  const chip: ChipStatus | undefined = body.chip && typeof body.chip === "object" ? body.chip : undefined;

  const now = Date.now();
  let device: DeviceInfo | undefined;
  updateStore(store => {
    const prev = store.device;
    const same = sameKey(prev, body);
    device = {
      name,
      backend,
      qx: hasKey ? body.qx : undefined,
      qy: hasKey ? body.qy : undefined,
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: now,
      pairTxHash: same ? prev!.pairTxHash : undefined,
      chip: chip ?? prev?.chip,
    };
    store.device = device;
  });

  const onchain = await onchainSigner().catch(() => undefined);
  const paired = hasKey && !!onchain && sameKey(onchain, body);
  return NextResponse.json({ paired, device, relayer: relayerAddress() });
}

export async function GET() {
  const { device } = readStore();
  const onchain = await onchainSigner().catch(() => undefined);
  return NextResponse.json({ device, onchain, paired: sameKey(onchain, device) });
}
