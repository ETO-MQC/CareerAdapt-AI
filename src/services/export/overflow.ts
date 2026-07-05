import type { OverflowStatus } from "@/domain/schemas";

export type A4OverflowMeasurement = {
  status: OverflowStatus;
  remainingPx: number;
  scrollHeight: number;
  clientHeight: number;
};

export function classifyA4Overflow(input: { scrollHeight: number; clientHeight: number }): A4OverflowMeasurement {
  const remainingPx = input.clientHeight - input.scrollHeight;
  const status: OverflowStatus = input.scrollHeight > input.clientHeight + 2
    ? "overflow"
    : remainingPx <= 36
      ? "near_limit"
      : "fits";

  return {
    status,
    remainingPx,
    scrollHeight: input.scrollHeight,
    clientHeight: input.clientHeight
  };
}
