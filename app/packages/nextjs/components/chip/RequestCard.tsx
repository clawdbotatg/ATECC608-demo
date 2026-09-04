"use client";

import { ago, short, usd } from "./types";
import { Address } from "@scaffold-ui/components";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import type { TransferRequest } from "~~/services/chip/types";
import { getBlockExplorerTxLink } from "~~/utils/scaffold-eth";

const STEPS = ["Requested", "Signed on chip", "Relayed", "Confirmed"] as const;

function stepIndex(r: TransferRequest) {
  switch (r.status) {
    case "pending":
      return 0;
    case "signed":
      return 1;
    case "relaying":
      return 2;
    case "confirmed":
      return 3;
    default:
      return r.txHash ? 2 : r.signature ? 1 : 0;
  }
}

const BADGE: Record<TransferRequest["status"], string> = {
  pending: "badge-warning",
  signed: "badge-info",
  relaying: "badge-info",
  confirmed: "badge-success",
  failed: "badge-error",
  expired: "badge-ghost",
};

const LABEL: Record<TransferRequest["status"], string> = {
  pending: "waiting for the chip",
  signed: "signed, relaying",
  relaying: "relaying…",
  confirmed: "confirmed",
  failed: "failed",
  expired: "expired",
};

export const RequestCard = ({ r, now }: { r: TransferRequest; now: number }) => {
  const { targetNetwork } = useTargetNetwork();
  const idx = stepIndex(r);
  const dead = r.status === "failed" || r.status === "expired";
  const txLink = r.txHash ? getBlockExplorerTxLink(targetNetwork.id, r.txHash) : undefined;
  const signMs = r.signedAt ? r.signedAt - r.createdAt : undefined;
  const totalMs = r.status === "confirmed" ? r.updatedAt - r.createdAt : undefined;

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">{r.amountFormatted}</span>
            <span className="font-semibold">{r.tokenSymbol}</span>
            <span className="text-sm opacity-60">{usd(r.amountFormatted)}</span>
          </div>
          <span className={`badge ${BADGE[r.status]} gap-1`}>
            {(r.status === "pending" || r.status === "relaying" || r.status === "signed") && (
              <span className="loading loading-spinner loading-xs" />
            )}
            {LABEL[r.status]}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="opacity-60">to</span>
          {r.toName && <span className="font-semibold">{r.toName}</span>}
          <Address address={r.to} chain={targetNetwork} size="sm" />
        </div>

        <ul className="steps steps-horizontal text-xs w-full">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={`step ${i <= idx ? (dead && i === idx ? "step-error" : "step-primary") : ""}`}
              data-content={i < idx || (i === idx && r.status === "confirmed") ? "✓" : dead && i === idx ? "✕" : i + 1}
            >
              {label}
            </li>
          ))}
        </ul>

        <div className="grid gap-1 font-mono text-xs opacity-80">
          <div className="flex gap-2">
            <span className="w-16 shrink-0 opacity-60">nonce</span>
            <span>{r.nonce}</span>
            <span className="opacity-60 ml-4">deadline</span>
            <span>{new Date(r.deadline * 1000).toLocaleTimeString()}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-16 shrink-0 opacity-60">digest</span>
            <span className="break-all" title={r.digest}>
              {r.digest}
            </span>
          </div>
          {r.signature && (
            <>
              <div className="flex gap-2">
                <span className="w-16 shrink-0 opacity-60">sig r</span>
                <span className="break-all">{r.signature.r}</span>
              </div>
              <div className="flex gap-2">
                <span className="w-16 shrink-0 opacity-60">sig s</span>
                <span className="break-all">{r.signature.s}</span>
              </div>
            </>
          )}
          {r.txHash && (
            <div className="flex gap-2">
              <span className="w-16 shrink-0 opacity-60">tx</span>
              {txLink ? (
                <a className="link link-primary break-all" href={txLink} target="_blank" rel="noreferrer">
                  {r.txHash}
                </a>
              ) : (
                <span className="break-all">{r.txHash}</span>
              )}
              {r.gasUsed && (
                <span className="opacity-60 whitespace-nowrap">{Number(r.gasUsed).toLocaleString()} gas</span>
              )}
            </div>
          )}
          {r.relayer && (
            <div className="flex gap-2">
              <span className="w-16 shrink-0 opacity-60">relayer</span>
              <span>{short(r.relayer, 8)} paid the gas</span>
            </div>
          )}
          {r.error && <div className="text-error break-words">{r.error}</div>}
        </div>

        <div className="flex flex-wrap gap-3 text-xs opacity-60">
          <span>created {ago(r.createdAt, now)}</span>
          {signMs !== undefined && <span>· chip signed after {(signMs / 1000).toFixed(1)}s</span>}
          {totalMs !== undefined && <span>· settled in {(totalMs / 1000).toFixed(1)}s total</span>}
        </div>
      </div>
    </div>
  );
};
