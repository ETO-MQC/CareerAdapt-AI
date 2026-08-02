"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { hasCustomAiSettings } from "@/services/storage/aiSettings";

export function SetupGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Keep the first render identical on the server and client. The settings
  // check belongs in the effect because it reads browser-only localStorage.
  const [ready, setReady] = useState(false);
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
