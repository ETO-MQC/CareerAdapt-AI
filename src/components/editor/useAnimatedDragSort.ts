"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";

/** Preview with CSS order, then persist once on release. Pointer capture keeps the target stable while rows slide. */
export function useAnimatedDragSort(ids: string[], _mime: string, onCommit: (order: string[], moved: string) => unknown | Promise<unknown>) {
  const root = useRef<HTMLElement | null>(null);
  const ghost = useRef<HTMLElement | null>(null);
  const gesture = useRef<{ id: string; x: number; y: number; active: boolean; pointerId: number; handle: HTMLElement } | undefined>(undefined);
  const orderRef = useRef<string[]>([]);
  const previous = useRef(new Map<string, DOMRect>());
  const [dragging, setDragging] = useState<string>();
  const [preview, setPreview] = useState<{ base: string; order: string[] }>();
  const base = ids.join("\u0000");
  const orderedIds = preview?.base === base ? preview.order : ids;
  const orderKey = orderedIds.join("\u0000");
  const rootRef = useCallback((node: HTMLElement | null) => { root.current = node; node?.setAttribute("data-sort-root", ""); }, []);
  function rows() {
    return Array.from(root.current?.querySelectorAll<HTMLElement>("[data-sort-id]") ?? []).filter(node => node.closest("[data-sort-root]") === root.current);
  }
  useLayoutEffect(() => {
    const rects = new Map<string, DOMRect>();
    root.current?.querySelectorAll<HTMLElement>("[data-sort-id]").forEach(node => {
      if (node.closest("[data-sort-root]") !== root.current) return;
      const id = node.dataset.sortId!; const rect = node.getBoundingClientRect(); const before = previous.current.get(id);
      rects.set(id, rect);
      if (dragging && before && Math.abs(before.top - rect.top) > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        node.getAnimations().forEach(animation => animation.cancel());
        node.animate([{ transform: `translateY(${before.top - rect.top}px)` }, { transform: "translateY(0)" }], { duration: 180, easing: "ease-out" });
      }
    });
    previous.current = rects;
  }, [orderKey, dragging]);
  const cancel = useCallback(() => {
    const current = gesture.current; gesture.current = undefined;
    if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    ghost.current?.remove(); ghost.current = null; setDragging(undefined); setPreview(undefined);
  }, []);
  useEffect(() => {
    if (!dragging) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [dragging, cancel]);
  useEffect(() => () => { ghost.current?.remove(); }, []);
  function itemProps(id: string) {
    return { style: { order: orderedIds.indexOf(id) }, "data-sort-id": id, "data-sort-dragging": dragging === id || undefined };
  }
  function handleProps(id: string) {
    return { draggable: false, onDragStart(event: React.DragEvent<HTMLElement>) { event.preventDefault(); },
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        gesture.current = { id, x: event.clientX, y: event.clientY, active: false, pointerId: event.pointerId, handle: event.currentTarget };
        orderRef.current = [...ids]; event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
        if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return;
        event.preventDefault(); event.stopPropagation();
        if (!current.active) {
          current.active = true; setDragging(id);
          const row = event.currentTarget.closest<HTMLElement>("[data-sort-id]");
          if (row) {
            const visual = row.querySelector<HTMLElement>(".sidebar-section-header") ?? row;
            const clone = visual.cloneNode(true) as HTMLElement; const rect = visual.getBoundingClientRect();
            clone.classList.add("sort-drag-ghost"); clone.removeAttribute("data-sort-dragging"); clone.setAttribute("aria-hidden", "true");
            clone.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
            Object.assign(clone.style, { position: "fixed", zIndex: "10000", width: `${rect.width}px`, height: `${rect.height}px`, pointerEvents: "none", margin: "0", transform: "none" });
            document.body.append(clone); ghost.current = clone;
          }
        }
        if (ghost.current) { ghost.current.style.left = `${event.clientX - 24}px`; ghost.current.style.top = `${event.clientY - 24}px`; }
        const row = rows().find(node => { const rect = node.getBoundingClientRect(); return node.dataset.sortId !== current.id && event.clientY >= rect.top && event.clientY <= rect.bottom; });
        if (row) {
          const next = [...orderRef.current]; const from = next.indexOf(current.id); const to = next.indexOf(row.dataset.sortId!);
          const rect = (row.querySelector(".sidebar-section-header") ?? row).getBoundingClientRect();
          if (from >= 0 && to >= 0 && (from < to ? event.clientY >= rect.top + rect.height / 2 : event.clientY <= rect.top + rect.height / 2)) {
            const [moved] = next.splice(from, 1); next.splice(to, 0, moved); orderRef.current = next; setPreview({ base, order: next });
          }
        }
        let scroll = root.current?.parentElement;
        while (scroll && !/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement;
        if (scroll) { const rect = scroll.getBoundingClientRect(); if (event.clientY > rect.bottom - 28) scroll.scrollTop += 12; else if (event.clientY < rect.top + 28) scroll.scrollTop -= 12; }
      },
      async onPointerUp(event: PointerEvent<HTMLElement>) {
        const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
        const rect = root.current?.getBoundingClientRect();
        const valid = current.active && rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        const next = [...orderRef.current]; cancel();
        if (valid && next.join("\u0000") !== base) { setPreview({ base, order: next }); try { await onCommit(next, current.id); } finally { setPreview(undefined); } }
      },
      onPointerCancel: cancel, onLostPointerCapture() { if (gesture.current) cancel(); }
    };
  }
  return { orderedIds, rootRef, rootProps: { "data-sort-active": Boolean(dragging) }, itemProps, handleProps };
}
export type AnimatedDragSort = ReturnType<typeof useAnimatedDragSort>;
