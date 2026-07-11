"use client";

import { type ReactNode } from "react";

type AccordionItem = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  defaultOpen?: boolean;
  content: ReactNode;
};

type AccordionListProps = {
  items: AccordionItem[];
  emptyHint?: string;
  addButton?: ReactNode;
};

export function AccordionList({ items, emptyHint, addButton }: AccordionListProps) {
  if (items.length === 0) {
    return (
      <div className="accordion-empty">
        {emptyHint ? <p className="accordion-empty-hint">{emptyHint}</p> : null}
        {addButton}
      </div>
    );
  }

  return (
    <div className="accordion-list" data-slot="accordion">
      {addButton ? <div className="accordion-add-bar">{addButton}</div> : null}
      {items.map((item) => (
        <details
          key={item.id}
          className="accordion-item"
          open={item.defaultOpen}
        >
          <summary className="accordion-item-trigger">
            <span className="accordion-item-title">{item.title}</span>
            {item.subtitle ? <span className="accordion-item-subtitle">{item.subtitle}</span> : null}
            {item.badge ? <span className="accordion-item-badge">{item.badge}</span> : null}
            <span className="accordion-item-chevron" aria-hidden>▾</span>
          </summary>
          <div className="accordion-item-content">
            {item.content}
          </div>
        </details>
      ))}
    </div>
  );
}
