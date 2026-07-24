import type {
  ButtonHTMLAttributes,
  DialogHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes
} from "react";

type WithChildren<T = object> = T & { children?: ReactNode };

export function ProductPage({ children, className = "", ...props }: WithChildren<HTMLAttributes<HTMLElement>>) {
  return <main className={`product-page ${className}`} {...props}>{children}</main>;
}

export function ProductTopbar({
  title,
  status,
  actions
}: {
  title: string;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="product-topbar">
      <div className="product-topbar-heading">
        <h1>{title}</h1>
        {status ? <span className="product-topbar-status">{status}</span> : null}
      </div>
      {actions ? <div className="product-topbar-actions">{actions}</div> : null}
    </header>
  );
}

export function ProductToolbar({ children, className = "", ...props }: WithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div className={`product-toolbar ${className}`} {...props}>{children}</div>;
}

export function ProductSurface({
  children,
  density = "normal",
  className = "",
  ...props
}: WithChildren<HTMLAttributes<HTMLElement>> & { density?: "compact" | "normal" | "spacious" }) {
  return <section className={`product-surface ${className}`} data-density={density} {...props}>{children}</section>;
}

export function ProductSection({
  title,
  actions,
  children,
  className = ""
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`product-section ${className}`}>
      {title || actions ? <header>{title ? <h2>{title}</h2> : <span />}{actions}</header> : null}
      {children}
    </section>
  );
}

export function ProductSplitPane({ children, className = "", ...props }: WithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div className={`product-split-pane ${className}`} {...props}>{children}</div>;
}

export function ProductFilterBar({ children, className = "", ...props }: WithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div className={`product-filter-bar ${className}`} {...props}>{children}</div>;
}

export function ProductButton({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return <button className={`product-button ${className}`} data-variant={variant} type="button" {...props} />;
}

export function ProductIconButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`product-icon-button ${className}`} type="button" {...props} />;
}

export function ProductInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`product-input ${className}`} {...props} />;
}

export function ProductSelect({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`product-select ${className}`} {...props} />;
}

export function ProductTabs({ children, className = "", ...props }: WithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div className={`product-tabs ${className}`} role="tablist" {...props}>{children}</div>;
}

export function ProductBadge({ children, className = "", ...props }: WithChildren<HTMLAttributes<HTMLSpanElement>>) {
  return <span className={`product-badge ${className}`} {...props}>{children}</span>;
}

export function ProductDataCard({ children, className = "", ...props }: WithChildren<HTMLAttributes<HTMLElement>>) {
  return <article className={`product-data-card ${className}`} {...props}>{children}</article>;
}

export function ProductDataRow({ children, className = "", ...props }: WithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div className={`product-data-row ${className}`} {...props}>{children}</div>;
}

export function ProductEmptyState({
  title,
  description,
  actions
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="product-empty-state">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {actions ? <ProductToolbar>{actions}</ProductToolbar> : null}
    </section>
  );
}

export function ProductDialog({ className = "", ...props }: DialogHTMLAttributes<HTMLDialogElement>) {
  return <dialog className={`product-dialog ${className}`} {...props} />;
}

export function ProductDrawer({ children, className = "", ...props }: WithChildren<HTMLAttributes<HTMLElement>>) {
  return <aside className={`product-drawer ${className}`} {...props}>{children}</aside>;
}

export function ProductField({
  label,
  htmlFor,
  children,
  className = ""
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`product-field ${className}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
