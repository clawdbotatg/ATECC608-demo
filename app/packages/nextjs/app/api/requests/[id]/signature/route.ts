import { NextRequest, NextResponse } from "next/server";
import { isHex } from "viem";
import { executeTransfer, isValidTransfer, normalizeLowS, onchainNonce } from "~~/services/chip/relay";
import { findRequest, patchRequest, readStore, updateStore } from "~~/services/chip/store";
import { getParsedError } from "~~/utils/scaffold-eth/getParsedError";

export const dynamic = "force-dynamic";

const isBytes32 = (v: unknown): v is `0x${string}` => typeof v === "string" && isHex(v) && v.length === 66;

/**
 * The Pi posts the chip's signature here. We check it (free eth_call), then the relay pays gas to settle it.
 * The response waits for the receipt so the Pi's terminal shows the tx hash.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const request = findRequest(id);
  if (!request) return NextResponse.json({ error: "unknown request" }, { status: 404 });
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: `request is ${request.status}`, status: request.status, txHash: request.txHash },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  if (!isBytes32(body.r) || !isBytes32(body.s)) {
    return NextResponse.json({ error: "r and s must be 0x-prefixed 32-byte hex" }, { status: 400 });
  }
  const r = body.r as `0x${string}`;
  const s = normalizeLowS(body.s as `0x${string}`);

  if (request.deadline < Math.floor(Date.now() / 1000)) {
    patchRequest(id, { status: "expired", error: "signed after the deadline" });
    return NextResponse.json({ error: "deadline passed", status: "expired" }, { status: 410 });
  }

  const amount = BigInt(request.amount);
  const deadline = BigInt(request.deadline);

  // Pre-check against the contract when this request is next in line (the view uses the live nonce).
  const liveNonce = await onchainNonce();
  if (liveNonce.toString() === request.nonce) {
    const ok = await isValidTransfer(request.token, request.to, amount, deadline, r, s);
    if (!ok) {
      patchRequest(id, {
        status: "failed",
        error: "signature does not verify against the paired chip key",
        signature: { r, s },
      });
      return NextResponse.json({ error: "bad signature", status: "failed" }, { status: 400 });
    }
  }

  patchRequest(id, { status: "signed", signature: { r, s }, signedAt: Date.now() });

  try {
    patchRequest(id, { status: "relaying" });
    const { hash, receipt, relayer } = await executeTransfer(request.token, request.to, amount, deadline, r, s);
    const done = patchRequest(id, {
      status: receipt.status === "success" ? "confirmed" : "failed",
      txHash: hash as `0x${string}`,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      relayer: relayer as `0x${string}`,
      error: receipt.status === "success" ? undefined : "transaction reverted",
    });
    return NextResponse.json({
      status: done.status,
      txHash: hash,
      blockNumber: done.blockNumber,
      gasUsed: done.gasUsed,
    });
  } catch (e: any) {
    const error = getParsedError(e);
    patchRequest(id, { status: "failed", error });
    // Later requests were signed against a nonce that will now never happen — fail them too.
    updateStore(store => {
      for (const r2 of store.requests) {
        if (["pending", "signed"].includes(r2.status) && BigInt(r2.nonce) > BigInt(request.nonce)) {
          r2.status = "failed";
          r2.error = `queued behind request ${id}, which failed`;
          r2.updatedAt = Date.now();
        }
      }
    });
    void readStore();
    return NextResponse.json({ error, status: "failed" }, { status: 500 });
  }
}
