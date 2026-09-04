import { NextRequest, NextResponse } from "next/server";
import { readStore, updateStore } from "~~/services/chip/store";
import { Command, CommandType } from "~~/services/chip/types";

export const dynamic = "force-dynamic";

const TYPES: CommandType[] = ["status", "genkey", "lock-config"];

/** Pi: what should I do? Oldest first. */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const commands = readStore()
    .commands.filter(c => c.status === status)
    .sort((a, b) => a.createdAt - b.createdAt);
  return NextResponse.json({ commands });
}

/** Browser: queue a job for the Pi. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const type = body.type as CommandType;
  if (!TYPES.includes(type))
    return NextResponse.json({ error: `type must be one of ${TYPES.join(", ")}` }, { status: 400 });
  const open = readStore().commands.find(c => c.type === type && (c.status === "pending" || c.status === "running"));
  if (open) return NextResponse.json({ command: open }, { status: 200 });
  const now = Date.now();
  const command: Command = {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    createdAt: now,
    status: "pending",
  };
  updateStore(store => {
    store.commands.push(command);
  });
  return NextResponse.json({ command }, { status: 201 });
}
