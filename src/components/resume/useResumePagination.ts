"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import type { ResumePaginationPlan, ResumePresentationConfig } from "@/domain/schemas";
import {
  collectResumePaginationMeasurement,
  createResumePaginationPlan,
  isPaginationPlanBlocked,
  type ResumePaginationMeasurement
} from "@/services/export/pagination";

export type ResumePaginationState = {
  status: ResumePaginationPlan["status"] | "measuring" | "measurement_failed";
  plan?: ResumePaginationPlan;
  measurement?: ResumePaginationMeasurement;
  blocked: boolean;
  measure: () => void;
};

export function useResumePagination(
  ref: RefObject<HTMLElement | null>,
  paginationConfig?: ResumePresentationConfig["pagination"],
  deps: unknown[] = []
): ResumePaginationState {
  const [plan, setPlan] = useState<ResumePaginationPlan | undefined>();
  const [measurement, setMeasurement] = useState<ResumePaginationMeasurement | undefined>();
  const [status, setStatus] = useState<ResumePaginationState["status"]>("measuring");

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element || !paginationConfig) {
      setPlan(undefined);
      setMeasurement(undefined);
      setStatus("measurement_failed");
      return;
    }
    try {
      const nextMeasurement = collectResumePaginationMeasurement(element);
      const nextPlan = createResumePaginationPlan({
        measurement: nextMeasurement,
        paginationConfig
      });
      setPlan(nextPlan);
      setMeasurement(nextMeasurement);
      setStatus(nextPlan.status);
    } catch {
      setPlan(undefined);
      setMeasurement(undefined);
      setStatus("measurement_failed");
    }
  }, [paginationConfig, ref]);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;

    const run = async () => {
      if ("fonts" in document) {
        await document.fonts.ready;
      }
      if (cancelled) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        if (!cancelled) {
          measure();
        }
      });
    };
    void run();

    const element = ref.current;
    if (!element) {
      return () => {
        cancelled = true;
        if (frame) {
          window.cancelAnimationFrame(frame);
        }
      };
    }

    const observer = new ResizeObserver(() => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        if (!cancelled) {
          measure();
        }
      });
    });
    observer.observe(element);

    return () => {
      cancelled = true;
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return {
    status,
    plan,
    measurement,
    blocked: isPaginationPlanBlocked(plan),
    measure
  };
}
