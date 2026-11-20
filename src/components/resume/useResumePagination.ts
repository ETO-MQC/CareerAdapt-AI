"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
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
  measure: () => ResumePaginationPlan | undefined;
};

export function useResumePagination(
  ref: RefObject<HTMLElement | null>,
  paginationConfig?: ResumePresentationConfig["pagination"],
  deps: unknown[] = [],
  previewZoom = 1
): ResumePaginationState {
  const [plan, setPlan] = useState<ResumePaginationPlan | undefined>();
  const [measurement, setMeasurement] = useState<ResumePaginationMeasurement | undefined>();
  const [status, setStatus] = useState<ResumePaginationState["status"]>("measuring");
  const [previewReserve, setPreviewReserve] = useState(0);

  const measure = useCallback((): ResumePaginationPlan | undefined => {
    const element = ref.current;
    if (!element || !paginationConfig) {
      setPlan(undefined);
      setMeasurement(undefined);
      setStatus("measurement_failed");
      return undefined;
    }
    try {
      const nextMeasurement = collectResumePaginationMeasurement(element);
      const nextPlan = createResumePaginationPlan({
        measurement: nextMeasurement,
        paginationConfig
      });
      setPreviewReserve(0);
      setPlan(nextPlan);
      setMeasurement(nextMeasurement);
      setStatus(nextPlan.status);
      return nextPlan;
    } catch {
      setPlan(undefined);
      setMeasurement(undefined);
      setStatus("measurement_failed");
      return undefined;
    }
  }, [paginationConfig, ref]);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;

    const scheduleMeasure = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }
        // Do not keep presenting the previous plan while the edited content
        // or presentation settings are being measured again. The old
        // one-page plan would render a fixed-height shell and hide newly
        // overflowing content.
        setPlan(undefined);
        setMeasurement(undefined);
        setStatus("measuring");
        frame = window.requestAnimationFrame(() => {
          if (!cancelled) {
            measure();
          }
        });
      });
    };

    const run = async () => {
      if ("fonts" in document) {
        await document.fonts.ready;
      }
      if (cancelled) {
        return;
      }
      scheduleMeasure();
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
      scheduleMeasure();
    });
    observer.observe(element);
    element.querySelectorAll<HTMLElement>("[data-render-section]").forEach(section => observer.observe(section));
    if ("fonts" in document) document.fonts.addEventListener("loadingdone", scheduleMeasure);

    return () => {
      cancelled = true;
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      if ("fonts" in document) document.fonts.removeEventListener("loadingdone", scheduleMeasure);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  useLayoutEffect(() => {
    if (!plan || !measurement || !paginationConfig) return;
    const preview = ref.current?.nextElementSibling;
    if (!preview?.classList.contains("resume-preview-pages")) return;
    const pages = Array.from(preview.querySelectorAll<HTMLElement>('[data-testid="resume-a4-page"]'));
    if (pages.length !== plan.pages.length) return;

    let overflow = 0;
    let overflowUnitHeight = 0;
    for (const page of pages) {
      const bounds = page.getBoundingClientRect();
      const scale = bounds.height / page.offsetHeight;
      if (!scale) continue;
      const bottom = bounds.bottom - parseFloat(getComputedStyle(page).paddingBottom) * scale;
      for (const unit of page.querySelectorAll<HTMLElement>("[data-pagination-unit]")) {
        const rect = unit.getBoundingClientRect();
        const amount = (rect.bottom - bottom) / scale;
        if (amount > overflow) {
          overflow = amount;
          overflowUnitHeight = rect.height / scale;
        }
      }
    }
    if (overflow <= 1) return;
    const maximumReserve = Math.max(0, measurement.clientHeight - (measurement.paddingTop ?? 0) - (measurement.paddingBottom ?? 0) - 1);
    const buildPlan = (reserve: number) => createResumePaginationPlan({
      measurement: { ...measurement, paddingBottom: (measurement.paddingBottom ?? 0) + reserve },
      paginationConfig
    });
    const assignment = (candidate: ResumePaginationPlan) => JSON.stringify(candidate.pages.map(page => ({
      blockIds: page.blockIds,
      itemFragments: page.itemFragments
    })));
    const previousAssignment = assignment(plan);
    let nextReserve = Math.min(maximumReserve, previewReserve + overflow + 2);
    let nextPlan = buildPlan(nextReserve);
    if (assignment(nextPlan) === previousAssignment) {
      nextReserve = Math.min(maximumReserve, nextReserve + overflowUnitHeight);
      nextPlan = buildPlan(nextReserve);
    }
    if (nextReserve <= previewReserve || assignment(nextPlan) === previousAssignment) return;
    setPreviewReserve(nextReserve);
    setPlan(nextPlan);
    setStatus(nextPlan.status);
  }, [measurement, paginationConfig, plan, previewReserve, previewZoom, ref]);

  return {
    status,
    plan,
    measurement,
    blocked: isPaginationPlanBlocked(plan),
    measure
  };
}
