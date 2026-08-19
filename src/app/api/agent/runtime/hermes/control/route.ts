import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({
    ok: false,
    error: {
      code: "control_not_supported_in_web",
      message: "当前为 Web 调试模式，Hermes 服务进程由外部环境管理，请使用重新连接或桌面版控制进程。"
    }
  }, { status: 409, headers: { "Cache-Control": "no-store" } });
}
