import { NextResponse } from "next/server";
import { relayerAddress } from "~~/services/chip/chain";
import { admin, onchainSigner, setSigner } from "~~/services/chip/relay";
import { readStore, updateStore } from "~~/services/chip/store";

export const dynamic = "force-dynamic";

/** Browser: make the contract trust the device's current key (setSigner). */
export async function POST() {
  const { device } = readStore();
  if (!device?.qx || !device.qy)
    return NextResponse.json({ error: "device has no key yet — generate one first" }, { status: 400 });
  const onchain = await onchainSigner();
  if (onchain.qx.toLowerCase() === device.qx.toLowerCase() && onchain.qy.toLowerCase() === device.qy.toLowerCase()) {
    return NextResponse.json({ paired: true, txHash: device.pairTxHash });
  }
  const adminAddr = await admin();
  if (adminAddr.toLowerCase() !== relayerAddress().toLowerCase()) {
    return NextResponse.json(
      {
        error: `contract admin is ${adminAddr} but the relay is ${relayerAddress()}. Call setSigner(qx, qy) from the admin, or redeploy with CHIP_PUBKEY_X/Y.`,
        qx: device.qx,
        qy: device.qy,
      },
      { status: 403 },
    );
  }
  try {
    const txHash = await setSigner(device.qx, device.qy);
    updateStore(store => {
      if (store.device) store.device.pairTxHash = txHash;
    });
    return NextResponse.json({ paired: true, txHash });
  } catch (e: any) {
    return NextResponse.json({ error: e?.shortMessage || e?.message || String(e) }, { status: 500 });
  }
}
