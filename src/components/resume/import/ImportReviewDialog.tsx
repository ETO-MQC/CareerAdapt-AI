"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function ImportReviewDialog(props: {
  open: boolean;
  title: string;
  description?: string;
  variant?: "resume" | "agent";
  testId?: string;
  onClose(): void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [props.open]);

  if (!props.open) return null;
  const titleId = `import-review-title-${props.variant ?? "resume"}`;

  return (
    <div
      className={`resume-import-modal-backdrop no-print import-review-dialog-${props.variant ?? "resume"}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="resume-import-modal"
        data-testid={props.testId ?? "resume-import-dock"}
        data-import-review-variant={props.variant ?? "resume"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const dialog = dialogRef.current;
          if (!dialog) return;
          const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )).filter((element) => !element.hasAttribute("hidden"));
          if (!focusable.length) {
            event.preventDefault();
            dialog.focus();
            return;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="resume-import-modal-header">
          <div>
            <h2 id={titleId}>{props.title}</h2>
            {props.description ? <p>{props.description}</p> : null}
          </div>
          <button className="resume-import-modal-close" type="button" aria-label="关闭导入窗口" onClick={props.onClose}>
            ×
          </button>
        </header>
        <div className="resume-import-modal-body">{props.children}</div>
      </section>
    </div>
  );
}
