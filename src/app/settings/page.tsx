export default function SettingsPage() {
  return (
    <main className="page-shell">
      <section className="page-title">
        <p className="eyebrow">偏好</p>
        <h1>设置</h1>
        <p>调整界面主题和显示密度。简历纸张、模板颜色和 PDF 导出不会随应用主题反转。</p>
      </section>

      <section className="panel settings-panel">
        <h2>界面偏好</h2>
        <p>顶部栏提供主题和密度切换。偏好保存在本机浏览器，不会创建简历版本，也不会修改简历正文。</p>
        <dl className="info-list">
          <div>
            <dt>主题</dt>
            <dd>明亮、暗黑或跟随系统</dd>
          </div>
          <div>
            <dt>密度</dt>
            <dd>紧凑或舒适</dd>
          </div>
          <div>
            <dt>导出</dt>
            <dd>A4 纸张保持白色，PDF 不受应用主题影响</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
