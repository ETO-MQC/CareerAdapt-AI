import type { DocumentRecognitionModelId } from "@/domain/schemas";

export type DocumentRecognitionModelOption = {
  id: DocumentRecognitionModelId;
  label: string;
  sourceLabel: string;
  repository: string;
  runtimeLabel: string;
  sizeLabel: string;
  description: string;
  sourceUrl: string;
  fileSet: "paddle" | "openvino_int4" | "official_gguf" | "gguf_q4_k_m" | "gguf_q5_k_m" | "gguf_q6_k" | "gguf_q8_0";
  supportsCurrentPaddleSidecar: boolean;
};

export const DOCUMENT_RECOGNITION_MODEL_OPTIONS: readonly DocumentRecognitionModelOption[] = [
  {
    id: "official_paddle_bf16",
    label: "官方 PaddleOCR-VL-1.6 · BF16",
    sourceLabel: "PaddlePaddle 官方",
    repository: "PaddlePaddle/PaddleOCR-VL-1.6",
    runtimeLabel: "PaddleOCR / PaddlePaddle（当前本地 OCR）",
    sizeLabel: "约 1.9 GB",
    description: "当前应用 sidecar 直接支持；GPU 推荐，CPU 也可按官方运行时使用。",
    sourceUrl: "https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6",
    fileSet: "paddle",
    supportsCurrentPaddleSidecar: true
  },
  {
    id: "hf_int8_safetensors",
    label: "Hugging Face · INT8 Safetensors",
    sourceLabel: "Hugging Face 社区量化",
    repository: "olragon/PaddleOCR-VL-1.6-8bit",
    runtimeLabel: "Transformers / 对应量化运行时",
    sizeLabel: "约 1.1 GB",
    description: "显存占用更低；下载后需配置对应 Transformers 量化适配器，不能直接交给 PaddleOCR sidecar。",
    sourceUrl: "https://huggingface.co/olragon/PaddleOCR-VL-1.6-8bit",
    fileSet: "paddle",
    supportsCurrentPaddleSidecar: false
  },
  {
    id: "hf_int4_openvino",
    label: "Hugging Face · OpenVINO INT4",
    sourceLabel: "Hugging Face 社区量化",
    repository: "sublatesublate-design/PaddleOCR-VL-1.6-OpenVINO-INT4",
    runtimeLabel: "OpenVINO",
    sizeLabel: "约 1.4 GB",
    description: "面向 OpenVINO 的 INT4 权重；适合 CPU / Intel 设备，需先准备 OpenVINO 运行环境。",
    sourceUrl: "https://huggingface.co/sublatesublate-design/PaddleOCR-VL-1.6-OpenVINO-INT4",
    fileSet: "openvino_int4",
    supportsCurrentPaddleSidecar: false
  },
  {
    id: "official_gguf_bf16",
    label: "官方 GGUF · BF16",
    sourceLabel: "PaddlePaddle 官方 GGUF",
    repository: "PaddlePaddle/PaddleOCR-VL-1.6-GGUF",
    runtimeLabel: "llama.cpp（CPU，可选 GPU offload）",
    sizeLabel: "约 1.8 GB（含视觉投影）",
    description: "官方 llama.cpp 路线，包含模型权重和视觉投影文件；不接入当前 PaddleOCR sidecar。",
    sourceUrl: "https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF",
    fileSet: "official_gguf",
    supportsCurrentPaddleSidecar: false
  },
  {
    id: "gguf_q4_k_m",
    label: "GGUF · Q4_K_M",
    sourceLabel: "Hugging Face 社区量化",
    repository: "mradermacher/PaddleOCR-VL-1.6-GGUF",
    runtimeLabel: "llama.cpp（CPU，可选 GPU offload）",
    sizeLabel: "约 300 MB",
    description: "体积和效果较均衡的 GGUF 量化；下载后用 llama.cpp 或兼容前端加载。",
    sourceUrl: "https://huggingface.co/mradermacher/PaddleOCR-VL-1.6-GGUF",
    fileSet: "gguf_q4_k_m",
    supportsCurrentPaddleSidecar: false
  },
  {
    id: "gguf_q5_k_m",
    label: "GGUF · Q5_K_M",
    sourceLabel: "Hugging Face 社区量化",
    repository: "mradermacher/PaddleOCR-VL-1.6-GGUF",
    runtimeLabel: "llama.cpp（CPU，可选 GPU offload）",
    sizeLabel: "约 340 MB",
    description: "比 Q4_K_M 更偏向保留精度的 GGUF 量化。",
    sourceUrl: "https://huggingface.co/mradermacher/PaddleOCR-VL-1.6-GGUF",
    fileSet: "gguf_q5_k_m",
    supportsCurrentPaddleSidecar: false
  },
  {
    id: "gguf_q6_k",
    label: "GGUF · Q6_K",
    sourceLabel: "Hugging Face 社区量化",
    repository: "mradermacher/PaddleOCR-VL-1.6-GGUF",
    runtimeLabel: "llama.cpp（CPU，可选 GPU offload）",
    sizeLabel: "约 385 MB",
    description: "更偏向精度的 GGUF 量化，适合内存更充足的设备。",
    sourceUrl: "https://huggingface.co/mradermacher/PaddleOCR-VL-1.6-GGUF",
    fileSet: "gguf_q6_k",
    supportsCurrentPaddleSidecar: false
  },
  {
    id: "gguf_q8_0",
    label: "GGUF · Q8_0",
    sourceLabel: "Hugging Face 社区量化",
    repository: "mradermacher/PaddleOCR-VL-1.6-GGUF",
    runtimeLabel: "llama.cpp（CPU，可选 GPU offload）",
    sizeLabel: "约 500 MB",
    description: "更接近原始精度的 GGUF 量化，代价是更大的内存占用。",
    sourceUrl: "https://huggingface.co/mradermacher/PaddleOCR-VL-1.6-GGUF",
    fileSet: "gguf_q8_0",
    supportsCurrentPaddleSidecar: false
  }
];

export const DEFAULT_DOCUMENT_RECOGNITION_MODEL_ID: DocumentRecognitionModelId = "official_paddle_bf16";

export function getDocumentRecognitionModelOption(modelId: DocumentRecognitionModelId) {
  return DOCUMENT_RECOGNITION_MODEL_OPTIONS.find((option) => option.id === modelId) ?? DOCUMENT_RECOGNITION_MODEL_OPTIONS[0];
}
