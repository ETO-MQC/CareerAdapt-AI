"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { AgentPageContext } from "@/agent/contracts/agentContext";
import { serializeAgentPageContext } from "@/agent/contracts/agentContext";

type AgentPageContextValue = {
  context: AgentPageContext;
  updateContext(value: Partial<AgentPageContext>): void;
};

const Context = createContext<AgentPageContextValue | null>(null);

export function AgentPageContextProvider({
  children,
  route
}: {
  children: React.ReactNode;
  route: string;
}) {
  const [context, setContext] = useState<AgentPageContext>(() =>
    serializeAgentPageContext({ route, pathname: route, query: {} })
  );
  const updateContext = useCallback((value: Partial<AgentPageContext>) => {
    setContext((current) => serializeAgentPageContext({
      ...current,
      ...value,
      route: value.route ?? current.route ?? route,
      pathname: value.pathname ?? value.route ?? current.pathname ?? route,
      query: value.query ?? current.query
    }));
  }, [route]);
  const state = useMemo(() => ({ context, updateContext }), [context, updateContext]);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}

export function useAgentPageContext() {
  const value = useContext(Context);
  if (!value) throw new Error("useAgentPageContext must be used within AgentPageContextProvider");
  return value;
}
