import Link from "next/link";
import { demoCareerProfile } from "@/data/demoProfile";

export default function ResumePage() {
  return (
    <main className="page-shell">
      <section className="workspace-band">
        <div>
          <p className="eyebrow">Resume Workbench</p>
          <h1>简历工作台</h1>
          <p>{demoCareerProfile.name} 的静态 A4 预览已连接示例母档案。</p>
        </div>
        <Link className="primary-link" href="/export/probe">
          查看预览
        </Link>
      </section>
    </main>
  );
}
