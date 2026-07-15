"use client";

import { useSyncExternalStore } from "react";
import { notificationStore } from "@/services/notifications/store";

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(notificationStore.subscribe, notificationStore.getSnapshot, notificationStore.getServerSnapshot);
  return (
    <>
      {children}
      <section className="notification-viewport no-print" aria-label="操作通知" aria-live="polite" aria-atomic="false">
        {snapshot.visible.map((item) => (
          <article
            key={item.id}
            className={`app-notification app-notification-${item.type}`}
            role={item.type === "error" ? "alert" : "status"}
            onMouseEnter={() => notificationStore.pause(item.id)}
            onMouseLeave={() => notificationStore.resume(item.id)}
            onFocus={() => notificationStore.pause(item.id)}
            onBlur={() => notificationStore.resume(item.id)}
          >
            <span className="notification-status-icon" aria-hidden="true">{notificationIcon(item.type)}</span>
            <div className="notification-copy"><strong>{item.title}</strong>{item.message ? <p>{item.message}</p> : null}</div>
            <button type="button" className="notification-close" aria-label={`关闭通知：${item.title}`} onClick={() => notificationStore.dismiss(item.id)}>×</button>
          </article>
        ))}
      </section>
    </>
  );
}

function notificationIcon(type: "success" | "info" | "warning" | "error") {
  return { success: "✓", info: "i", warning: "!", error: "×" }[type];
}
