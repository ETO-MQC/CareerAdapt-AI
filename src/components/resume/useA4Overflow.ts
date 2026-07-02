"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import type { OverflowStatus } from "@/domain/schemas";

export type A4OverflowMeasurement = {
  status: OverflowStatus;
  remainingPx: number;
  scrollHeight: number;
  clientHeight: number;
};

export function classifyOverflow(input: { scrollHeight: number; clientHeight: number }): A4OverflowMeasurement {
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

export function useA4Overflow(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  const [measurement, setMeasurement] = useState<A4OverflowMeasurement>({
    status: "fits",
    remainingPx: 0,
    scrollHeight: 0,
    clientHeight: 0
  });

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    setMeasurement(classifyOverflow({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    }));
  }, [ref]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if ("fonts" in document) {
        await document.fonts.ready;
      }
      if (!cancelled) {
        measure();
      }
    };
    void run();

    const element = ref.current;
    if (!element) {
      return () => {
        cancelled = true;
      };
    }

    const observer = new ResizeObserver(() => measure());
    observer.observe(element);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return { ...measurement, measure };
}
