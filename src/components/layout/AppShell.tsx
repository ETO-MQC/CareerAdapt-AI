"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { NotificationProvider } from "@/components/notifications/NotificationProvider";
import { useWorkspaceMode } from "@/components/layout/WorkspaceModeProvider";
import { WORKSPACE_MODE_OPTIONS } from "@/services/preferences/workspaceMode";

type ThemePreference = "system" | "light" | "dark";
type DensityPreference = "compact" | "comfortable";
type NavIconName = "home" | "agent" | "resume" | "profile" | "jobs" | "applications" | "recycle" | "settings";

const themeStorageKey = "careeradapt.theme";
const densityStorageKey = "careeradapt.density";
const sidebarCollapsedStorageKey = "careeradapt.sidebarCollapsed";

const navItems = [
  { href: "/", label: "首页", icon: "home" },
  { href: "/ai-workspace", label: "AI 工作台", icon: "agent" },
  { href: "/resume", label: "我的简历", icon: "resume" },
  { href: "/profile", label: "个人资料库", icon: "profile" },
  { href: "/jobs", label: "岗位", icon: "jobs" },
  { href: "/applications", label: "求职进度", icon: "applications" },
  { href: "/recycle", label: "回收站", icon: "recycle" },
  { href: "/settings", label: "设置", icon: "settings" }
] satisfies Array<{ href: string; label: string; icon: NavIconName }>;

const themeOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "明亮" },
  { value: "dark", label: "暗黑" }
];

const densityOptions: Array<{ value: DensityPreference; label: string }> = [
  { value: "compact", label: "紧凑" },
  { value: "comfortable", label: "舒适" }
];

const pageTitles: Record<string, string> = {
  "/": "首页",
  "/ai-workspace": "AI 工作台",
  "/resume": "我的简历",
  "/profile": "个人资料库",
  "/jobs": "岗位",
  "/applications": "求职进度",
  "/recycle": "回收站",
  "/settings": "设置",
  "/export/probe": "A4预览检查"
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const { mode, setMode } = useWorkspaceMode();
  const [theme, setTheme] = useState<ThemePreference>(() => readInitialTheme());
  const [density, setDensity] = useState<DensityPreference>(() => readInitialDensity());
  const [hasSidebarPreference, setHasSidebarPreference] = useState(() => readHasSidebarPreference());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readInitialSidebarCollapsed());
  const isCompactResumeViewport = useMediaQuery("(max-width: 1400px)");
  const sidebarVisuallyCollapsed = sidebarCollapsed
    || (!hasSidebarPreference && pathname.startsWith("/resume") && isCompactResumeViewport);

  useEffect(() => {
    const apply = () => {
      applyRootPreferences(theme, density);
      window.localStorage.setItem(themeStorageKey, theme);
      window.localStorage.setItem(densityStorageKey, density);
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [density, theme]);

  useEffect(() => {
    const handlePreferenceChange = () => {
      const nextTheme = readInitialTheme();
      const nextDensity = readInitialDensity();
      applyRootPreferences(nextTheme, nextDensity);
      setTheme(nextTheme);
      setDensity(nextDensity);
    };
    window.addEventListener("careeradapt-preferences-change", handlePreferenceChange);
    return () => window.removeEventListener("careeradapt-preferences-change", handlePreferenceChange);
  }, []);

  useEffect(() => {
    if (hasSidebarPreference) {
      window.localStorage.setItem(sidebarCollapsedStorageKey, sidebarCollapsed ? "true" : "false");
    }
  }, [hasSidebarPreference, sidebarCollapsed]);

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

  return (
    <NotificationProvider>
    <div className={`app-shell ${sidebarVisuallyCollapsed ? "app-shell-sidebar-collapsed" : ""}`}>
      <aside className="primary-sidebar no-print" aria-label="主导航">
        <div className="sidebar-brand-row">
          <Link className="brand" href="/" aria-label="返回首页" title="职适AI">
            <span className="brand-mark" aria-hidden="true">CA</span>
            <span className="brand-name">职适AI</span>
          </Link>
          <button
            className="icon-button sidebar-collapse-button"
            type="button"
            aria-label={sidebarVisuallyCollapsed ? "展开主导航" : "收起主导航"}
            title={sidebarVisuallyCollapsed ? "展开主导航" : "收起主导航"}
            onClick={() => {
              setHasSidebarPreference(true);
              setSidebarCollapsed(!sidebarVisuallyCollapsed);
            }}
          >
            <ShellIcon name={sidebarVisuallyCollapsed ? "expand" : "collapse"} />
          </button>
        </div>
        <nav>
          {navItems.map((item) => (
            <Link
              key={item.href}
              className={pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href)) ? "nav-link nav-link-active" : "nav-link"}
              href={item.href}
              aria-label={item.label}
              title={sidebarVisuallyCollapsed ? item.label : undefined}
            >
              <NavIcon name={item.icon} />
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <div className="app-main-frame">
        <header className="workspace-topbar no-print">
          <div className="topbar-title-row">
            <strong>{currentTitle}</strong>
          </div>
          <div className="topbar-actions">
            <div className="workspace-mode-compact" aria-label="工作区模式">
              {WORKSPACE_MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={mode === option.value}
                  className={mode === option.value ? "is-active" : ""}
                  onClick={() => setMode(option.value)}
                >
                  {option.label.replace("模式", "")}
                </button>
              ))}
            </div>
            <details className="appearance-menu">
              <summary className="secondary-button compact">
                <ShellIcon name="appearance" />
                <span>显示</span>
              </summary>
              <div className="appearance-menu-popover">
                <div className="appearance-menu-group" role="group" aria-label="主题">
                  <span>主题</span>
                  {themeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={theme === option.value ? "appearance-option appearance-option-active" : "appearance-option"}
                      onClick={() => setTheme(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="appearance-menu-group" role="group" aria-label="界面密度">
                  <span>密度</span>
                  {densityOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={density === option.value ? "appearance-option appearance-option-active" : "appearance-option"}
                      onClick={() => setDensity(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <Link className="appearance-link" href="/settings">设置与帮助</Link>
              </div>
            </details>
          </div>
        </header>
        {children}
      </div>
    </div>
    </NotificationProvider>
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

function readInitialSidebarCollapsed() {
  if (typeof window === "undefined") {
    return false;
  }
  const saved = window.localStorage.getItem(sidebarCollapsedStorageKey);
  if (saved === "true" || saved === "false") {
    return saved === "true";
  }
  return false;
}

function readHasSidebarPreference() {
  if (typeof window === "undefined") {
    return false;
  }
  const saved = window.localStorage.getItem(sidebarCollapsedStorageKey);
  return saved === "true" || saved === "false";
}

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined") {
        return () => undefined;
      }
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
    () => false
  );
}

function applyRootPreferences(theme: ThemePreference, density: DensityPreference) {
  const resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = theme;
  root.dataset.density = density;
}

function NavIcon({ name }: { name: NavIconName }) {
  const paths: Record<NavIconName, string[]> = {
    home: ["M4 11.5 12 5l8 6.5", "M6.5 10.5V19h11v-8.5", "M10 19v-5h4v5"],
    agent: ["M12 3v3", "M12 18v3", "M3 12h3", "M18 12h3", "M6.5 6.5l2 2", "M15.5 15.5l2 2", "M17.5 6.5l-2 2", "M8.5 15.5l-2 2", "M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z"],
    resume: ["M7 4h7l3 3v13H7z", "M14 4v4h4", "M9.5 11h5", "M9.5 14h5", "M9.5 17h3"],
    profile: ["M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z", "M5.5 20a6.5 6.5 0 0 1 13 0"],
    jobs: ["M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7", "M5 8h14v11H5z", "M5 12h14"],
    applications: ["M6 5h12v14H6z", "M9 9h6", "M9 12h6", "M9 15h4"],
    recycle: ["M4 7h16", "M9 7V4h6v3", "M7 7l1 13h8l1-13", "M10 11v5", "M14 11v5"],
    settings: ["M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z", "M4.5 12h2", "M17.5 12h2", "M12 4.5v2", "M12 17.5v2", "m6.7 6.7 1.4 1.4", "m15.9 15.9 1.4 1.4", "m17.3 6.7-1.4 1.4", "m8.1 15.9-1.4 1.4"]
  };
  return <SvgIcon paths={paths[name]} className="nav-icon" />;
}

function ShellIcon({ name }: { name: "collapse" | "expand" | "appearance" }) {
  const paths: Record<typeof name, string[]> = {
    collapse: ["M15 6l-6 6 6 6", "M20 4v16", "M4 4v16"],
    expand: ["M9 6l6 6-6 6", "M4 4v16", "M20 4v16"],
    appearance: ["M12 4v3", "M12 17v3", "M4 12h3", "M17 12h3", "M6.3 6.3l2.1 2.1", "M15.6 15.6l2.1 2.1", "M17.7 6.3l-2.1 2.1", "M8.4 15.6l-2.1 2.1", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"]
  };
  return <SvgIcon paths={paths[name]} />;
}

function SvgIcon({ paths, className }: { paths: string[]; className?: string }) {
  return (
    <svg className={className ?? "button-icon"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
