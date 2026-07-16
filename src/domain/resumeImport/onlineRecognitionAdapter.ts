import type { DocumentEngineHealth } from "@/domain/schemas";
import type { ResumeOcrRunOptions } from "./ocrAdapter";

export type OnlineDocumentRecognitionResult = {
  ok: false;
  code: "not_configured";
  message: string;
  engine: string;
  warnings: string[];
};

export interface OnlineDocumentRecognitionAdapter {
  readonly engine: string;
  health(): Promise<DocumentEngineHealth>;
  recognize(file: File, options?: ResumeOcrRunOptions): Promise<OnlineDocumentRecognitionResult>;
}

export const baiduQianfanRecognitionAdapter: OnlineDocumentRecognitionAdapter = {
  engine: "baidu-qianfan",
  async health() {
    return {
      engine: "baidu-qianfan",
      status: "missing",
      message: "百度千帆在线识别尚未配置；本轮未接入真实 API。"
    };
  },
  async recognize(): Promise<OnlineDocumentRecognitionResult> {
    return {
      ok: false,
      code: "not_configured",
      message: "百度千帆在线识别尚未配置。",
      engine: "baidu-qianfan",
      warnings: ["未发送文件，未保存 API key 或识别输出。"]
    };
  }
};
