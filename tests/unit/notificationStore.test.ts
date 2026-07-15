import { afterEach, describe, expect, it, vi } from "vitest";
import { createNotificationStore } from "@/services/notifications/store";

describe("notification store", () => {
  afterEach(() => vi.useRealTimers());

  it("shows at most three notifications and queues the rest", () => {
    const store = createNotificationStore();
    store.notify({ type: "success", title: "1", duration: 0 });
    store.notify({ type: "info", title: "2", duration: 0 });
    store.notify({ type: "warning", title: "3", duration: 0 });
    store.notify({ type: "error", title: "4", duration: 0 });
    expect(store.getSnapshot().visible.map((item) => item.title)).toEqual(["1", "2", "3"]);
    expect(store.getSnapshot().queued.map((item) => item.title)).toEqual(["4"]);
    store.dismiss(store.getSnapshot().visible[0].id);
    expect(store.getSnapshot().visible.map((item) => item.title)).toEqual(["2", "3", "4"]);
  });

  it("deduplicates repeated messages and automatically dismisses", () => {
    vi.useFakeTimers();
    const store = createNotificationStore();
    const first = store.notify({ type: "success", title: "保存成功", message: "已创建版本", duration: 1000 });
    const duplicate = store.notify({ type: "success", title: "保存成功", message: "已创建版本", duration: 1000 });
    expect(duplicate).toBe(first);
    expect(store.getSnapshot().visible).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(store.getSnapshot().visible).toHaveLength(0);
  });

  it("pauses and resumes automatic dismissal", () => {
    vi.useFakeTimers();
    const store = createNotificationStore();
    const id = store.notify({ type: "error", title: "失败", duration: 2000 });
    vi.advanceTimersByTime(500);
    store.pause(id);
    vi.advanceTimersByTime(3000);
    expect(store.getSnapshot().visible).toHaveLength(1);
    store.resume(id);
    vi.advanceTimersByTime(1500);
    expect(store.getSnapshot().visible).toHaveLength(0);
  });
});
