export type NotificationType = "success" | "info" | "warning" | "error";

export type NotificationInput = {
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
};

export type AppNotification = Required<Pick<NotificationInput, "type" | "title">> & {
  id: string;
  message?: string;
  duration: number;
  createdAt: number;
  remaining: number;
  paused: boolean;
};

export type NotificationSnapshot = { visible: AppNotification[]; queued: AppNotification[] };

const EMPTY_SNAPSHOT: NotificationSnapshot = { visible: [], queued: [] };

export function createNotificationStore(options: { now?: () => number; schedule?: typeof setTimeout; cancel?: typeof clearTimeout } = {}) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let sequence = 0;
  let snapshot = EMPTY_SNAPSHOT;
  const listeners = new Set<() => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const startedAt = new Map<string, number>();

  const emit = () => listeners.forEach((listener) => listener());
  const setSnapshot = (next: NotificationSnapshot) => { snapshot = next; emit(); };

  const arm = (item: AppNotification) => {
    if (item.duration <= 0 || item.paused) return;
    startedAt.set(item.id, now());
    timers.set(item.id, schedule(() => dismiss(item.id), item.remaining));
  };

  const dismiss = (id: string) => {
    const timer = timers.get(id);
    if (timer) cancel(timer);
    timers.delete(id); startedAt.delete(id);
    const wasVisible = snapshot.visible.some((item) => item.id === id);
    const nextVisible = snapshot.visible.filter((item) => item.id !== id);
    const nextQueued = snapshot.queued.filter((item) => item.id !== id);
    if (wasVisible && nextQueued.length > 0) {
      const [promoted, ...rest] = nextQueued;
      nextVisible.push(promoted);
      setSnapshot({ visible: nextVisible, queued: rest });
      arm(promoted);
      return;
    }
    setSnapshot({ visible: nextVisible, queued: nextQueued });
  };

  const notify = (input: NotificationInput) => {
    const createdAt = now();
    const duplicate = [...snapshot.visible, ...snapshot.queued].find((item) =>
      item.type === input.type && item.title === input.title && item.message === input.message && createdAt - item.createdAt < 1_500
    );
    if (duplicate) return duplicate.id;
    const duration = input.duration ?? (input.type === "error" ? 7_000 : 4_000);
    const item: AppNotification = { ...input, id: `notification-${++sequence}`, duration, remaining: duration, createdAt, paused: false };
    if (snapshot.visible.length < 3) {
      setSnapshot({ ...snapshot, visible: [...snapshot.visible, item] });
      arm(item);
    } else {
      setSnapshot({ ...snapshot, queued: [...snapshot.queued, item] });
    }
    return item.id;
  };

  const pause = (id: string) => {
    const item = snapshot.visible.find((candidate) => candidate.id === id);
    if (!item || item.paused) return;
    const timer = timers.get(id);
    if (timer) cancel(timer);
    timers.delete(id);
    const elapsed = now() - (startedAt.get(id) ?? now());
    startedAt.delete(id);
    setSnapshot({ ...snapshot, visible: snapshot.visible.map((candidate) => candidate.id === id ? { ...candidate, paused: true, remaining: Math.max(0, candidate.remaining - elapsed) } : candidate) });
  };

  const resume = (id: string) => {
    const item = snapshot.visible.find((candidate) => candidate.id === id);
    if (!item || !item.paused) return;
    const resumed = { ...item, paused: false };
    setSnapshot({ ...snapshot, visible: snapshot.visible.map((candidate) => candidate.id === id ? resumed : candidate) });
    arm(resumed);
  };

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY_SNAPSHOT,
    notify,
    dismiss,
    pause,
    resume,
    clear() {
      timers.forEach((timer) => cancel(timer));
      timers.clear(); startedAt.clear(); setSnapshot(EMPTY_SNAPSHOT);
    }
  };
}

export const notificationStore = createNotificationStore();
export const notify = notificationStore.notify;
