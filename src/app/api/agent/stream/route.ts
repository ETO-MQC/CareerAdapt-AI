import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The native planner/model stream was retired when Hermes became the sole
 * semantic runtime. Keep the endpoint as an explicit deprecation response so
 * stale clients fail clearly instead of starting a second agent loop.
 */
export async function POST() {
  return NextResponse.json({
    error: {
      code: "hermes_runtime_required",
      message: "Production agent turns use the Hermes runtime."
    }
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
