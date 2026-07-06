import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "职适AI",
  description: "CareerAdapt AI MVP workspace"
};

const navItems = [
  { href: "/", label: "项目空间" },
  { href: "/profile", label: "职业母档案" },
  { href: "/jobs", label: "岗位工作区" },
  { href: "/resume", label: "简历工作台" },
  { href: "/applications", label: "求职工作台" },
  { href: "/export/probe", label: "A4 探针" }
];

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="app-header no-print">
          <Link className="brand" href="/">
            职适AI
          </Link>
          <nav aria-label="主导航">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
