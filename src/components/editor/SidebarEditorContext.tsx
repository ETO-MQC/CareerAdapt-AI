"use client";

import { createContext, useContext } from "react";

export const SidebarEditorContext = createContext(false);
export const useSidebarEditor = () => useContext(SidebarEditorContext);
