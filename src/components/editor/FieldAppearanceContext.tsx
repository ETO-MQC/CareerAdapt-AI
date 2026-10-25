"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { FieldAppearance } from "@/domain/schemas/fieldAppearance";

export const FieldAppearanceContext = createContext<{
  entries: FieldAppearance[];
  onChange: (update: (entries: FieldAppearance[]) => FieldAppearance[]) => void;
} | undefined>(undefined);
const FieldOwnerContext = createContext<string | undefined>(undefined);
export function FieldOwner({ itemId, children }: { itemId: string; children: ReactNode }) {
  return <FieldOwnerContext.Provider value={itemId}>{children}</FieldOwnerContext.Provider>;
}
export function useFieldAppearance() {
  return { store: useContext(FieldAppearanceContext), itemId: useContext(FieldOwnerContext) };
}
