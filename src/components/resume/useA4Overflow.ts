"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { classifyA4Overflow, type A4OverflowMeasurement } from "@/services/export/overflow";

export const classifyOverflow = classifyA4Overflow;
export type { A4OverflowMeasurement };

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
    setMeasurement(classifyA4Overflow({
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
