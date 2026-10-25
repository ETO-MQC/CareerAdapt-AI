"use client";
import { createContext, useContext, useEffect } from "react";
export const EditorDraftStatusContext = createContext<(key: string, dirty: boolean) => void>(() => {});
export function useEditorDraftStatus(key: string, dirty: boolean) {
  const report = useContext(EditorDraftStatusContext);
  useEffect(() => { report(key, dirty); return () => report(key, false); }, [report, key, dirty]);
}
