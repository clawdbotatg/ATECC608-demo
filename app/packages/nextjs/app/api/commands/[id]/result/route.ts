import { NextRequest, NextResponse } from "next/server";
import { patchCommand, readStore } from "~~/services/chip/store";

export const dynamic = "force-dynamic";

/** Pi: here is what happened. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!readStore().commands.some(c => c.id === id))
    return NextResponse.json({ error: "unknown command" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const running = body.status === "running";
  const command = patchCommand(
    id,
    running
      ? { status: "running" }
      : {
          status: body.ok ? "done" : "failed",
          result: body.result,
          error: body.ok ? undefined : String(body.error ?? "failed").slice(0, 500),
          doneAt: Date.now(),
        },
  );
  return NextResponse.json({ command });
}
