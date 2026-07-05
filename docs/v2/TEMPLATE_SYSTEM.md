# Template System

## 目标

从V1两套模板升级为可持续扩展的正式模板中心。模板只控制视觉，不改变事实内容；切换模板不得丢失内容；模板不得生成新的事实。

## 核心结构

```ts
TemplateDefinition {
  id
  version
  metadata
  capabilities
  defaultTheme
  layoutTokens
  typographyTokens
  spacingTokens
  sectionPlacements
  render(ResumeDocument)
}
```

G2 第一阶段实际实现使用单一静态 Registry：`src/components/resume/templates/templateRegistry.tsx`。最终字段为：

```ts
ResumeTemplateDefinition {
  id
  name
  shortName
  description
  category
  layout
  atsLevel
  suitableRoles
  tags
  capabilities
  defaultPresentationStyle
  version
  status
  className
  render
  renderThumbnail
}
```

模板元数据不进入 Dexie，不新增模板数据库；当前选中模板继续保存到 `ResumePresentationConfig.templateId`。

## TemplateMetadata

- 名称、描述、缩略图、适用岗位标签。
- 分类：ATS、技术/研究、产品/运营、金融/咨询、外贸/跨境、校园实习。
- ATS兼容标记。
- 支持语言：中文、英文、双语。
- 推荐页数：一页、两页。

## TemplateCapability

- 单栏/双栏。
- 是否支持头像。
- 是否支持主题色。
- 是否支持两页。
- 是否支持 Section 级断页。
- 是否支持续页页眉。
- 是否支持侧栏。
- 是否支持双语字段。
- 是否适合ATS。

## Tokens

- `TemplateTheme`：主题色、文本色、分割线、强调色。
- `LayoutToken`：页边距、栏宽、栏目顺序、页眉页脚。
- `TypographyToken`：字号、行高、字体族、标题层级。
- `SpacingToken`：section间距、bullet间距、段落间距。
- `SectionPlacement`：section默认位置和可放置区域。

## 内容与模板分离

ResumeDocument保存内容、事实引用和展示配置；TemplateDefinition只读取内容并渲染。模板切换不写事实、不触发Fact Guard、不创建内容Revision。

## 第一批模板建议

第一批建议4套，不一次开发十几套：

1. ATS极简模板：单栏、无头像、黑白、强ATS兼容。
2. 数据/技术/研究模板：单栏或轻双栏，突出项目、技能和成果。
3. 产品/运营模板：清晰模块、强调职责、执行和协作。
4. 金融/咨询/商务模板：稳重、信息密度高、强调教育和量化结果。

外贸/跨境电商模板和校园实习/应届生模板可作为G2后半或G5模板推荐补充；中英文双语模板作为后续评估，不进入首个Goal。

## G2第一阶段实际模板

已落地四套模板：

1. `classic-technical`：稳重技术，单栏，ATS友好等级 high。
2. `modern-operations`：简洁现代，轻双栏，ATS友好等级 medium。
3. `ats-minimal`：ATS极简单栏，单栏，ATS友好等级 high。
4. `business-consulting`：商务咨询正式，双栏，ATS友好等级 medium。

ATS等级仅为产品内部结构标签，不表示外部认证或保证通过。

G3b 后四套模板能力统一声明：

- `supportsTwoPages: true`
- `supportsSectionPageBreaks: true`
- `supportsContinuationHeader: false`

当前第二页不重复候选人 Header，避免导出的两页 PDF 出现重复个人信息。若后续需要续页页眉，应作为单独模板能力设计和验收。

## Template Center

G2第一阶段在 `/resume` 右侧区域增加模板中心：

- 保留原快速模板下拉作为 fallback。
- 模板卡片展示缩略图、名称、说明、布局、ATS友好等级和适用岗位。
- 筛选项：全部、ATS优先、单栏、双栏、技术简洁、商务正式。
- 缩略图复用正式模板 renderer 和当前 `ResumeRenderModel`，不写入展示配置，不独立测量 overflow，不进入 PDF。
- 应用模板复用现有展示操作串行队列，增加 `presentationRevision`，不创建内容 `ResumeRevision`，不运行 Fact Guard。

## 模板升级兼容

- 模板必须有版本号。
- 模板升级不得删除用户配置，无法兼容时保留旧版本渲染。
- 模板元数据和渲染测试必须一起更新。

## 模板测试

- 每套模板至少有A4截图测试、分页/overflow测试、PDF文本抽取测试、模板切换内容一致性测试。
- 双栏模板必须验证中文文本不裁切。
- ATS模板必须避免把正文渲染成图片。
- 支持两页的模板必须验证一页严格阻断、最多两页导出、Section 断页不产生空白第一页、页码标签不进入 PDF。
