"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type ThemePreference = "system" | "light" | "dark";
type DensityPreference = "compact" | "comfortable";

const themeStorageKey = "careeradapt.theme";
const densityStorageKey = "careeradapt.density";

const navItems = [
  { href: "/", label: "首页" },
  { href: "/resume", label: "我的简历" },
  { href: "/profile", label: "个人资料库" },
  { href: "/jobs", label: "岗位" },
  { href: "/applications", label: "求职进度" },
  { href: "/settings", label: "设置" }
];

const pageTitles: Record<string, string> = {
  "/": "首页",
  "/resume": "我的简历",
  "/profile": "个人资料库",
  "/jobs": "岗位",
  "/applications": "求职进度",
  "/settings": "设置",
  "/export/probe": "A4预览检查"
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const [theme, setTheme] = useState<ThemePreference>(() => readInitialTheme());
  const [density, setDensity] = useState<DensityPreference>(() => readInitialDensity());

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const resolved = theme === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;
      root.dataset.theme = resolved;
      root.dataset.themePreference = theme;
      root.dataset.density = density;
      window.localStorage.setItem(themeStorageKey, theme);
      window.localStorage.setItem(densityStorageKey, density);
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [density, theme]);

  const currentTitle = useMemo(() => {
    const exact = pageTitles[pathname];
    if (exact) {
      return exact;
    }
    const match = Object.entries(pageTitles)
      .filter(([href]) => href !== "/" && pathname.startsWith(href))
      .sort((a, b) => b[0].length - a[0].length)[0];
    return match?.[1] ?? "工作区";
  }, [pathname]);

  function cycleTheme() {
    setTheme((current) => current === "system" ? "light" : current === "light" ? "dark" : "system");
  }

  return (
    <div className="app-shell">
      <aside className="primary-sidebar no-print" aria-label="主导航">
        <Link className="brand" href="/" aria-label="返回首页">
          职适AI
        </Link>
        <nav>
          {navItems.map((item) => (
            <Link
              key={item.href}
              className={pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href)) ? "nav-link nav-link-active" : "nav-link"}
              href={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="app-main-frame">
        <header className="workspace-topbar no-print">
          <div>
            <span className="topbar-kicker">当前工作区</span>
            <strong>{currentTitle}</strong>
          </div>
          <div className="topbar-actions">
            <span className="global-save-state">本地自动保存</span>
            <button className="secondary-button compact" type="button" onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}>
              {density === "compact" ? "紧凑" : "舒适"}
            </button>
            <button className="secondary-button compact" type="button" onClick={cycleTheme} aria-label="切换主题">
              {theme === "system" ? "跟随系统" : theme === "light" ? "明亮" : "暗黑"}
            </button>
            <Link className="secondary-button compact shell-help-link" href="/settings">帮助</Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function readInitialTheme(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  const savedTheme = window.localStorage.getItem(themeStorageKey);
  return savedTheme === "light" || savedTheme === "dark" || savedTheme === "system" ? savedTheme : "system";
}

function readInitialDensity(): DensityPreference {
  if (typeof window === "undefined") {
    return "compact";
  }
  const savedDensity = window.localStorage.getItem(densityStorageKey);
  return savedDensity === "compact" || savedDensity === "comfortable" ? savedDensity : "compact";
}
