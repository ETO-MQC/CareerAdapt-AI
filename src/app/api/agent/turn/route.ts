import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The legacy local planner endpoint is retired; Hermes owns agent turns. */
export async function POST() {
  return NextResponse.json({
    error: {
      code: "hermes_runtime_required",
      message: "Production agent turns use the Hermes runtime."
    }
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
