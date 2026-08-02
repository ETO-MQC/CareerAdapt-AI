"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { hasCustomAiSettings } from "@/services/storage/aiSettings";

export function SetupGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(() => {
    // 初始化时检查，避免 effect 中同步 setState
    if (typeof window === "undefined") return false;
    return hasCustomAiSettings();
  });
  const checkedRef = useRef(false);

  useEffect(() => {
    // 如果在设置页面，不需要检查
    if (pathname === "/setup") {
      if (!checkedRef.current) {
        checkedRef.current = true;
        setReady(true);
      }
      return;
    }

    // 检查是否已配置 API key
    if (!hasCustomAiSettings()) {
      router.replace("/setup");
    } else if (!checkedRef.current) {
      checkedRef.current = true;
      setReady(true);
    }
  }, [pathname, router]);

  // 在 setup 页面或已配置时显示子组件
  if (pathname === "/setup" || ready) {
    return <>{children}</>;
  }

  // 未配置时显示空白（即将跳转）
  return null;
}
