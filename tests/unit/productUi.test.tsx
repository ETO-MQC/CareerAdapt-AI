import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ProductButton,
  ProductSurface
} from "@/components/ui/product";

describe("product UI", () => {
  it.each(["primary", "secondary", "ghost", "danger"] as const)(
    "renders the %s button variant",
    (variant) => {
      render(<ProductButton variant={variant}>{variant}</ProductButton>);
      expect(screen.getByRole("button", { name: variant })).toHaveAttribute("data-variant", variant);
    }
  );

  it.each(["compact", "normal", "spacious"] as const)(
    "renders the %s surface density",
    (density) => {
      const { container } = render(<ProductSurface density={density}>content</ProductSurface>);
      expect(container.firstChild).toHaveAttribute("data-density", density);
    }
  );
});
