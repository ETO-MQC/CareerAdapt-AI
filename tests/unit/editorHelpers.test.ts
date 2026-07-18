import { describe, expect, it } from "vitest";
import { extractStructuredField, updateStructuredFieldInText } from "@/components/editor/helpers";
import { parseStructuredExperienceText, serializeStructuredExperienceText } from "@/domain/resumeFields/catalog";

describe("resume editor structured field helpers", () => {
  it("keeps organization, role, location and dates independent", () => {
    let text = "星河科技 / 产品经理  上海  2024.03 - 至今\n负责企业产品规划";

    text = updateStructuredFieldInText(text, "role", "高级产品经理");
    text = updateStructuredFieldInText(text, "location", "杭州");
    text = updateStructuredFieldInText(text, "start", "2023-06-01");

    expect(extractStructuredField(text, "organization")).toBe("星河科技");
    expect(extractStructuredField(text, "role")).toBe("高级产品经理");
    expect(extractStructuredField(text, "location")).toBe("杭州");
    expect(extractStructuredField(text, "start")).toBe("2023-06-01");
    expect(extractStructuredField(text, "current")).toBe("true");
    expect(text).toContain("负责企业产品规划");
  });

  it("enables an end date without moving it into another field", () => {
    let text = "示例大学 / 计算机科学  某地  2022 - 至今\n本科";
    text = updateStructuredFieldInText(text, "current", "false");
    text = updateStructuredFieldInText(text, "end", "2026-06-01");

    expect(extractStructuredField(text, "organization")).toBe("示例大学");
    expect(extractStructuredField(text, "role")).toBe("计算机科学");
    expect(extractStructuredField(text, "location")).toBe("某地");
    expect(extractStructuredField(text, "end")).toBe("2026-06-01");
    expect(extractStructuredField(text, "current")).toBe("false");
  });

  it("round-trips education degree, major, location and courses independently", () => {
    const text = serializeStructuredExperienceText({
      organization: "示例大学",
      role: "",
      degree: "本科",
      major: "计算机相关专业",
      location: "上海",
      courses: "数据结构、操作系统",
      startDate: "2021-09-01",
      endDate: "2025-06-30",
      current: false,
      description: "完成毕业设计并获优秀评价。",
      highlights: []
    }, "education");

    expect(parseStructuredExperienceText(text)).toMatchObject({
      organization: "示例大学",
      role: "本科",
      major: "计算机相关专业",
      location: "上海",
      courses: "数据结构、操作系统",
      startDate: "2021-09-01",
      endDate: "2025-06-30",
      description: "完成毕业设计并获优秀评价。"
    });
  });
});
