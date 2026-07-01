"use client";

export function WorkspaceLoadingState() {
  return (
    <section className="panel workspace-state" aria-live="polite">
      <h2>正在加载 workspace</h2>
      <p>首次打开会先写入阶段A演示 workspace，然后从 IndexedDB 读取页面数据。</p>
    </section>
  );
}

export function WorkspaceErrorState({ message }: { message: string }) {
  return (
    <section className="panel workspace-state" role="alert">
      <h2>workspace 加载失败</h2>
      <p>{message}</p>
    </section>
  );
}

export function WorkspaceEmptyState() {
  return (
    <section className="panel workspace-state">
      <h2>workspace 暂无数据</h2>
      <p>IndexedDB 中还没有职业母档案或岗位数据。重新 seed 后页面会显示 Repository 中的数据。</p>
    </section>
  );
}
