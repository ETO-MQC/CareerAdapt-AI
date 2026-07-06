"use client";

export function WorkspaceLoadingState() {
  return (
    <section className="panel workspace-state" aria-live="polite">
      <h2>正在加载数据</h2>
      <p>首次打开会准备一份本地示例数据，随后你可以创建自己的资料、简历和岗位。</p>
    </section>
  );
}

export function WorkspaceErrorState({ message }: { message: string }) {
  return (
    <section className="panel workspace-state" role="alert">
      <h2>本地数据加载失败</h2>
      <p>{message}</p>
    </section>
  );
}

export function WorkspaceEmptyState() {
  return (
    <section className="panel workspace-state">
      <h2>还没有可用数据</h2>
      <p>先创建个人资料或添加一个目标岗位，页面会在这里显示你的简历和求职进度。</p>
    </section>
  );
}
