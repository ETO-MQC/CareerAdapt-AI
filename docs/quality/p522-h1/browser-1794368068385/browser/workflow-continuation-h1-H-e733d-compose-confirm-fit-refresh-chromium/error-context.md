# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workflow-continuation-h1.spec.ts >> H1 bundled Hermes analyze/save/compose/confirm/fit/refresh
- Location: tests\e2e\workflow-continuation-h1.spec.ts:4:5

# Error details

```
Test timeout of 240000ms exceeded.
```

```
Error: locator.click: Test timeout of 240000ms exceeded.
Call log:
  - waiting for getByRole('dialog', { name: '导入资料', exact: true }).getByRole('button', { name: '确认导入', exact: true })
    - locator resolved to <button disabled type="button" class="primary-button">确认导入</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
      - waiting 100ms
    391 × waiting for element to be visible, enabled and stable
        - element is not enabled
      - retrying click action
        - waiting 500ms

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - generic [ref=e12]:
    - complementary "AI 工作区导航" [ref=e13]:
      - generic [ref=e14]:
        - link "职适AI 首页" [ref=e15] [cursor=pointer]:
          - /url: /
          - generic [ref=e16]: 职
          - generic [ref=e17]: 职适AI
        - button "收起 AI 导航" [ref=e18] [cursor=pointer]:
          - img [ref=e19]
      - generic [ref=e22]:
        - button "新任务" [ref=e23] [cursor=pointer]:
          - img [ref=e24]
          - generic [ref=e25]: 新任务
        - button "搜索 / 历史" [ref=e26] [cursor=pointer]:
          - img [ref=e27]
          - generic [ref=e30]: 搜索 / 历史
      - navigation "资产" [ref=e31]:
        - generic [ref=e32]: 资产
        - link "AI 助手" [ref=e33] [cursor=pointer]:
          - /url: /ai-workspace
          - img [ref=e34]
          - generic [ref=e37]: AI 助手
        - link "我的简历" [ref=e38] [cursor=pointer]:
          - /url: /resume
          - img [ref=e39]
          - generic [ref=e42]: 我的简历
        - link "个人资料库" [ref=e43] [cursor=pointer]:
          - /url: /profile
          - img [ref=e44]
          - generic [ref=e47]: 个人资料库
        - link "岗位" [ref=e48] [cursor=pointer]:
          - /url: /jobs
          - img [ref=e49]
          - generic [ref=e53]: 岗位
        - link "求职进度" [ref=e54] [cursor=pointer]:
          - /url: /applications
          - img [ref=e55]
          - generic [ref=e57]: 求职进度
        - link "回收站" [ref=e58] [cursor=pointer]:
          - /url: /recycle
          - img [ref=e59]
          - generic [ref=e66]: 回收站
      - region "最近任务" [ref=e67]:
        - text: 最近任务
        - generic [ref=e68]:
          - button "新的对话 任务状态：等待输入" [ref=e69] [cursor=pointer]:
            - generic [ref=e71]: 新的对话
            - generic "任务状态：等待输入" [ref=e72]: 等待输入
          - generic [ref=e73]:
            - button "重命名" [ref=e74] [cursor=pointer]:
              - img [ref=e75]
            - button "归档" [ref=e78] [cursor=pointer]:
              - img [ref=e79]
      - generic [ref=e82]:
        - generic "工作区模式" [ref=e83]:
          - button "AI" [pressed] [ref=e84] [cursor=pointer]:
            - generic [ref=e85]: AI
          - button "协作" [ref=e86] [cursor=pointer]:
            - generic [ref=e87]: 协作
          - button "手动" [ref=e88] [cursor=pointer]:
            - generic [ref=e89]: 手动
        - link "设置与更多" [ref=e90] [cursor=pointer]:
          - /url: /settings
          - img [ref=e91]
          - generic [ref=e94]: 设置与更多
        - generic [ref=e95]:
          - generic [ref=e96]: CA
          - generic [ref=e97]:
            - strong [ref=e98]: 求职工作区
            - generic [ref=e99]: 本地数据
    - main [ref=e102]:
      - generic [ref=e104]:
        - heading "我的简历" [level=1] [ref=e105]
        - generic [ref=e106]: 0 份当前简历 · 7 条经历 · 5 项基础信息
      - region "当前人物与版本" [ref=e107]:
        - generic [ref=e108]:
          - generic [ref=e109]: 同
          - generic [ref=e110]:
            - generic [ref=e111]:
              - strong [ref=e112]: 同学
              - generic [ref=e113]: V1
              - generic [ref=e114]: 当前
            - generic [ref=e115]:
              - generic [ref=e116]: 创建于 2026/07/01
              - generic [ref=e117]: 7 条经历 · 5 项基础信息
              - generic [ref=e118]: 0 份简历
        - generic [ref=e119]:
          - button "管理人物与版本" [ref=e120] [cursor=pointer]:
            - img [ref=e121]
            - text: 管理人物与版本
          - group [ref=e124]:
            - generic "更多人物与版本操作" [ref=e125] [cursor=pointer]:
              - img [ref=e126]
      - generic [ref=e130]:
        - article [ref=e131]:
          - generic [ref=e132]:
            - button "导入已有简历 核对来源后创建通用简历" [ref=e133] [cursor=pointer]:
              - strong [ref=e134]: 导入已有简历
              - generic [ref=e135]: 核对来源后创建通用简历
            - button "根据岗位创建 需要先在岗位工作区生成草稿" [disabled] [ref=e136]:
              - strong [ref=e137]: 根据岗位创建
              - generic [ref=e138]: 需要先在岗位工作区生成草稿
            - button "从个人资料库创建 复制已确认信息，之后由你决定是否再次同步" [ref=e139] [cursor=pointer]:
              - strong [ref=e140]: 从个人资料库创建
              - generic [ref=e141]: 复制已确认信息，之后由你决定是否再次同步
            - button "从零创建 不带入资料库内容，从空白字段开始" [ref=e142] [cursor=pointer]:
              - strong [ref=e143]: 从零创建
              - generic [ref=e144]: 不带入资料库内容，从空白字段开始
            - button "导入资料 证书、奖项、成绩单与经历证明" [ref=e145] [cursor=pointer]:
              - strong [ref=e146]: 导入资料
              - generic [ref=e147]: 证书、奖项、成绩单与经历证明
            - dialog "导入资料" [ref=e149]:
              - generic [ref=e150]:
                - generic [ref=e151]:
                  - heading "导入资料" [level=2] [ref=e152]
                  - paragraph [ref=e153]: 证书、奖项、成绩单与经历证明，核对后加入个人资料库。
                - button "关闭导入窗口" [ref=e154] [cursor=pointer]: ×
              - generic [ref=e156]:
                - generic [ref=e157]:
                  - paragraph [ref=e158]: 来源：h1-profile.json
                  - button "选择另一份材料" [ref=e159] [cursor=pointer]
                - generic [ref=e160]:
                  - status [ref=e161]: 等待核对。已切换目标或用途，请重新核对并明确确认。
                  - button "选择要导入的简历文件" [ref=e162]
                  - group "导入目标" [ref=e163]:
                    - generic [ref=e164]: 导入目标
                    - generic [ref=e165]:
                      - text: 材料用途
                      - textbox "材料用途" [ref=e166]: 补充个人资料
                    - generic [ref=e167]:
                      - generic [ref=e168]:
                        - generic [ref=e169] [cursor=pointer]:
                          - radio "导入到已有资料" [ref=e170]
                          - text: 导入到已有资料
                        - generic [ref=e171] [cursor=pointer]:
                          - radio "创建新人物" [checked] [ref=e172]
                          - text: 创建新人物
                      - generic [ref=e173]:
                        - generic [ref=e174]:
                          - text: 人物名称
                          - textbox "人物名称" [active] [ref=e175]:
                            - /placeholder: 将从导入姓名预填
                            - text: H1合成人物
                        - generic [ref=e176]:
                          - checkbox "同时创建通用简历" [disabled] [ref=e177]
                          - text: 同时创建通用简历
                  - region "识别方式" [ref=e178]:
                    - strong [ref=e179]: 识别方式
                    - generic "已使用的识别方式" [ref=e180]:
                      - generic [ref=e181]: 仅人工核对
                      - generic [ref=e182]: 仅本地
                    - group [ref=e183]:
                      - generic "路线详情" [ref=e184] [cursor=pointer]
                  - generic [ref=e185]:
                    - generic [ref=e186]:
                      - heading "核对结构" [level=3] [ref=e187]
                      - generic [ref=e188]: 1 项待处理
                      - generic [ref=e189]: 字段候选 0 项待确认 · 结构条目 0 项待确认 · 未识别来源 1 项 · 结构冲突 0 项
                    - group [ref=e190]:
                      - generic "批量操作" [ref=e191] [cursor=pointer]
                  - generic [ref=e192]:
                    - complementary [ref=e193]:
                      - group [ref=e194]:
                        - generic "原始材料与来源：h1-profile.json" [ref=e195]
                        - paragraph [ref=e196]:
                          - text: SHA-256：
                          - code [ref=e197]: 2c966b1bbde8f1850f2b83fce183739344ca65e38217e4fe854281802e2d32ff
                        - paragraph [ref=e198]: 分类：UNKNOWN / REVIEW_REQUIRED · 用途：补充个人资料
                        - link "查看 / 下载原附件" [ref=e199] [cursor=pointer]:
                          - /url: blob:http://127.0.0.1:3198/cea2c2c2-1cfe-411f-b3c8-db21b2f7a79b
                        - paragraph [ref=e200]: 识别置信度只描述识别结果，不代表事实真实性。人工修改保存在候选中。
                        - group [ref=e201]:
                          - generic "第 1 页 · 来源块 1 · json_mapper · 100%" [ref=e202]
                        - group [ref=e203]:
                          - generic "第 1 页 · 来源块 2 · json_mapper · 100%" [ref=e204]
                        - group [ref=e205]:
                          - generic "第 1 页 · 来源块 3 · json_mapper · 100%" [ref=e206]
                        - group [ref=e207]:
                          - generic "第 1 页 · 来源块 4 · json_mapper · 100%" [ref=e208]
                        - group [ref=e209]:
                          - generic "第 1 页 · 来源块 5 · json_mapper · 100%" [ref=e210]
                        - group [ref=e211]:
                          - generic "第 1 页 · 来源块 6 · json_mapper · 100%" [ref=e212]
                        - group [ref=e213]:
                          - generic "第 1 页 · 来源块 7 · json_mapper · 100%" [ref=e214]
                        - group [ref=e215]:
                          - generic "第 1 页 · 来源块 8 · json_mapper · 100%" [ref=e216]
                        - group [ref=e217]:
                          - generic "第 1 页 · 来源块 9 · json_mapper · 100%" [ref=e218]
                        - group [ref=e219]:
                          - generic "第 1 页 · 来源块 10 · json_mapper · 100%" [ref=e220]
                        - group [ref=e221]:
                          - generic "第 1 页 · 来源块 11 · json_mapper · 100%" [ref=e222]
                        - group [ref=e223]:
                          - generic "第 1 页 · 来源块 12 · json_mapper · 100%" [ref=e224]
                        - group [ref=e225]:
                          - generic "第 1 页 · 来源块 13 · json_mapper · 100%" [ref=e226]
                        - group [ref=e227]:
                          - generic "第 1 页 · 来源块 14 · json_mapper · 100%" [ref=e228]
                        - group [ref=e229]:
                          - generic "第 1 页 · 来源块 15 · json_mapper · 100%" [ref=e230]
                        - group [ref=e231]:
                          - generic "第 1 页 · 来源块 16 · json_mapper · 100%" [ref=e232]
                        - group [ref=e233]:
                          - generic "第 1 页 · 来源块 17 · json_mapper · 100%" [ref=e234]
                        - group [ref=e235]:
                          - generic "第 1 页 · 来源块 18 · json_mapper · 100%" [ref=e236]
                        - group [ref=e237]:
                          - generic "第 1 页 · 来源块 19 · json_mapper · 100%" [ref=e238]
                        - group [ref=e239]:
                          - generic "第 1 页 · 来源块 20 · json_mapper · 100%" [ref=e240]
                        - group [ref=e241]:
                          - generic "第 1 页 · 来源块 21 · json_mapper · 100%" [ref=e242]
                        - group [ref=e243]:
                          - generic "第 1 页 · 来源块 22 · json_mapper · 100%" [ref=e244]
                        - group [ref=e245]:
                          - generic "第 1 页 · 来源块 23 · json_mapper · 100%" [ref=e246]
                        - group [ref=e247]:
                          - generic "第 1 页 · 来源块 24 · json_mapper · 100%" [ref=e248]
                      - status [ref=e249]:
                        - generic [ref=e250]:
                          - strong [ref=e251]: 外部 JSON
                          - text: 24 个来源块
                        - generic [ref=e252]:
                          - strong [ref=e253]: 确定性字段映射
                          - text: 0 个字段候选
                        - generic [ref=e254]:
                          - strong [ref=e255]: 有保留项
                          - text: 1 个未识别来源
                      - generic "第 1 页来源文本" [ref=e256]: careeradapt-resume-v2 zh-CN H1合成人物 project project 项目经历 0 true h1-project project AI应用项目 项目成员 参与 AI 应用项目的需求梳理、原型设计和功能验收。 参与 AI 应用项目的需求梳理、原型设计和功能验收。 internship internship 实习经历 1 true h1-internship internship 合成公司 开发实习生 参与产品测试与缺陷记录。
                      - paragraph [ref=e258]: 24 个来源块已保存；请对照原文件核对。
                    - generic [ref=e259]:
                      - generic [ref=e260]:
                        - strong [ref=e261]: 基本信息
                        - generic [ref=e262]:
                          - generic [ref=e264]:
                            - text: 姓名
                            - textbox "姓名" [ref=e265]
                          - generic [ref=e267]:
                            - text: 邮箱
                            - textbox "邮箱" [ref=e268]
                          - generic [ref=e270]:
                            - text: 电话
                            - textbox "电话" [ref=e271]
                          - generic [ref=e273]:
                            - text: 地点
                            - textbox "地点" [ref=e274]
                          - generic [ref=e276]:
                            - text: 求职意向
                            - textbox "求职意向" [ref=e277]
                          - generic [ref=e279]:
                            - text: 概述
                            - textbox "概述" [ref=e280]
                      - article [ref=e281]:
                        - generic [ref=e282]:
                          - generic [ref=e283]:
                            - checkbox "project" [checked] [ref=e284]
                            - text: project
                          - combobox "project栏目类型" [ref=e285]:
                            - option "个人概述"
                            - option "教育经历"
                            - option "工作经历"
                            - option "实习经历"
                            - option "项目成果" [selected]
                            - option "奖项"
                            - option "技能"
                            - option "证书"
                            - option "语言"
                            - option "其他材料"
                            - option "旧版经历（需拆分）"
                            - option "其他/待确认"
                          - generic [ref=e286]:
                            - button "本栏目使用导入" [ref=e287] [cursor=pointer]
                            - button "本栏目保留现有" [ref=e288] [cursor=pointer]
                      - article [ref=e289]:
                        - generic [ref=e290]:
                          - generic [ref=e291]:
                            - checkbox "project" [checked] [ref=e292]
                            - text: project
                          - combobox "project栏目类型" [ref=e293]:
                            - option "个人概述"
                            - option "教育经历"
                            - option "工作经历"
                            - option "实习经历"
                            - option "项目成果" [selected]
                            - option "奖项"
                            - option "技能"
                            - option "证书"
                            - option "语言"
                            - option "其他材料"
                            - option "旧版经历（需拆分）"
                            - option "其他/待确认"
                          - generic [ref=e294]:
                            - button "本栏目使用导入" [ref=e295] [cursor=pointer]
                            - button "本栏目保留现有" [ref=e296] [cursor=pointer]
                      - article [ref=e297]:
                        - generic [ref=e298]:
                          - generic [ref=e299]:
                            - checkbox "项目经历" [checked] [ref=e300]
                            - text: 项目经历
                          - combobox "项目经历栏目类型" [ref=e301]:
                            - option "个人概述"
                            - option "教育经历"
                            - option "工作经历"
                            - option "实习经历"
                            - option "项目成果" [selected]
                            - option "奖项"
                            - option "技能"
                            - option "证书"
                            - option "语言"
                            - option "其他材料"
                            - option "旧版经历（需拆分）"
                            - option "其他/待确认"
                          - generic [ref=e302]:
                            - button "本栏目使用导入" [ref=e303] [cursor=pointer]
                            - button "本栏目保留现有" [ref=e304] [cursor=pointer]
                        - generic [ref=e305]:
                          - generic [ref=e306]:
                            - checkbox "AI 已识别 / 第 ? 页" [checked] [ref=e307]
                            - text: AI 已识别 / 第 ? 页
                          - generic [ref=e308]:
                            - generic [ref=e309]:
                              - term [ref=e310]: 项目名称
                              - definition [ref=e311]: "0"
                            - generic [ref=e312]:
                              - term [ref=e313]: 角色
                              - definition [ref=e314]: true | h1-project
                            - generic [ref=e315]:
                              - term [ref=e316]: 编辑候选 / 补充信息
                              - definition [ref=e317]:
                                - generic [ref=e318]:
                                  - text: 项目名称
                                  - textbox "材料候选项目名称" [ref=e319]: "0"
                                - generic [ref=e320]:
                                  - text: 组织
                                  - textbox "材料候选组织" [ref=e321]
                                - generic [ref=e322]:
                                  - text: 个人角色
                                  - textbox "材料候选个人角色" [ref=e323]: true | h1-project
                                - generic [ref=e324]:
                                  - text: 开始日期
                                  - textbox "材料候选开始日期" [ref=e325]
                                - generic [ref=e326]:
                                  - text: 结束日期
                                  - textbox "材料候选结束日期" [ref=e327]
                                - generic [ref=e328]:
                                  - text: 说明
                                  - textbox "材料候选说明" [ref=e329]
                                - generic [ref=e330]: 修改保留为用户编辑，请采用此条后再正式确认。
                          - group [ref=e331]:
                            - generic "查看来源原文" [ref=e332] [cursor=pointer]
                          - generic [ref=e333]:
                            - button "上移" [ref=e334] [cursor=pointer]
                            - button "下移" [ref=e335] [cursor=pointer]
                            - button "合并" [ref=e336] [cursor=pointer]
                            - button "拆分" [ref=e337] [cursor=pointer]
                      - article [ref=e338]:
                        - generic [ref=e339]:
                          - generic [ref=e340]:
                            - checkbox "project" [checked] [ref=e341]
                            - text: project
                          - combobox "project栏目类型" [ref=e342]:
                            - option "个人概述"
                            - option "教育经历"
                            - option "工作经历"
                            - option "实习经历"
                            - option "项目成果" [selected]
                            - option "奖项"
                            - option "技能"
                            - option "证书"
                            - option "语言"
                            - option "其他材料"
                            - option "旧版经历（需拆分）"
                            - option "其他/待确认"
                          - generic [ref=e343]:
                            - button "本栏目使用导入" [ref=e344] [cursor=pointer]
                            - button "本栏目保留现有" [ref=e345] [cursor=pointer]
                        - generic [ref=e346]:
                          - generic [ref=e347]:
                            - checkbox "AI 已识别 / 第 ? 页" [checked] [ref=e348]
                            - text: AI 已识别 / 第 ? 页
                          - generic [ref=e349]:
                            - generic [ref=e350]:
                              - term [ref=e351]: 项目名称
                              - definition [ref=e352]: AI应用项目
                            - generic [ref=e353]:
                              - term [ref=e354]: 角色
                              - definition [ref=e355]: 项目成员 | 参与 AI 应用项目的需求梳理、原型设计和功能验收。 | 参与 AI 应用项目的需求梳理、原型设计和功能验收。
                            - generic [ref=e356]:
                              - term [ref=e357]: 编辑候选 / 补充信息
                              - definition [ref=e358]:
                                - generic [ref=e359]:
                                  - text: 项目名称
                                  - textbox "材料候选项目名称" [ref=e360]: AI应用项目
                                - generic [ref=e361]:
                                  - text: 组织
                                  - textbox "材料候选组织" [ref=e362]
                                - generic [ref=e363]:
                                  - text: 个人角色
                                  - textbox "材料候选个人角色" [ref=e364]: 项目成员 | 参与 AI 应用项目的需求梳理、原型设计和功能验收。 | 参与 AI 应用项目的需求梳理、原型设计和功能验收。
                                - generic [ref=e365]:
                                  - text: 开始日期
                                  - textbox "材料候选开始日期" [ref=e366]
                                - generic [ref=e367]:
                                  - text: 结束日期
                                  - textbox "材料候选结束日期" [ref=e368]
                                - generic [ref=e369]:
                                  - text: 说明
                                  - textbox "材料候选说明" [ref=e370]
                                - generic [ref=e371]: 修改保留为用户编辑，请采用此条后再正式确认。
                          - group [ref=e372]:
                            - generic "查看来源原文" [ref=e373] [cursor=pointer]
                          - generic [ref=e374]:
                            - button "上移" [ref=e375] [cursor=pointer]
                            - button "下移" [ref=e376] [cursor=pointer]
                            - button "合并" [ref=e377] [cursor=pointer]
                            - button "拆分" [ref=e378] [cursor=pointer]
                      - article [ref=e379]:
                        - generic [ref=e380]:
                          - generic [ref=e381]:
                            - checkbox "internship" [checked] [ref=e382]
                            - text: internship
                          - combobox "internship栏目类型" [ref=e383]:
                            - option "个人概述"
                            - option "教育经历"
                            - option "工作经历"
                            - option "实习经历" [selected]
                            - option "项目成果"
                            - option "奖项"
                            - option "技能"
                            - option "证书"
                            - option "语言"
                            - option "其他材料"
                            - option "旧版经历（需拆分）"
                            - option "其他/待确认"
                          - generic [ref=e384]:
                            - button "本栏目使用导入" [ref=e385] [cursor=pointer]
                            - button "本栏目保留现有" [ref=e386] [cursor=pointer]
                      - article [ref=e387]:
                        - generic [ref=e388]:
                          - generic [ref=e389]:
                            - checkbox "internship" [checked] [ref=e390]
                            - text: internship
                          - combobox "internship栏目类型" [ref=e391]:
                            - option "个人概述"
                            - option "教育经历"
                            - option "工作经历"
                            - option "实习经历" [selected]
                            - option "项目成果"
                            - option "奖项"
                            - option "技能"
                            - option "证书"
                            - option "语言"
                            - option "其他材料"
                            - option "旧版经历（需拆分）"
                            - option "其他/待确认"
                          - generic [ref=e392]:
                            - button "本栏目使用导入" [ref=e393] [cursor=pointer]
                            - button "本栏目保留现有" [ref=e394] [cursor=pointer]
                      - article [ref=e395]:
                        - generic [ref=e396]:
                          - generic [ref=e397]:
                            - checkbox "实习经历" [checked] [ref=e398]
                            - text: 实习经历
                          - combobox "实习经历栏目类型" [ref=e399]:
                            - option "个人概述"
                            - option "教育经历"
                            - option "工作经历"
                            - option "实习经历" [selected]
                            - option "项目成果"
                            - option "奖项"
                            - option "技能"
                            - option "证书"
                            - option "语言"
                            - option "其他材料"
                            - option "旧版经历（需拆分）"
                            - option "其他/待确认"
                          - generic [ref=e400]:
                            - button "本栏目使用导入" [ref=e401] [cursor=pointer]
                            - button "本栏目保留现有" [ref=e402] [cursor=pointer]
                        - generic [ref=e403]:
                          - generic [ref=e404]:
                            - checkbox "AI 已识别 / 第 ? 页" [checked] [ref=e405]
                            - text: AI 已识别 / 第 ? 页
                          - generic [ref=e406]:
                            - generic [ref=e407]:
                              - term [ref=e408]: 组织
                              - definition [ref=e409]: "1"
                            - generic [ref=e410]:
                              - term [ref=e411]: 职位
                              - definition [ref=e412]: true | h1-internship
                            - generic [ref=e413]:
                              - term [ref=e414]: 编辑候选 / 补充信息
                              - definition [ref=e415]:
                                - generic [ref=e416]:
                                  - text: 组织
                                  - textbox "材料候选组织" [ref=e417]: "1"
                                - generic [ref=e418]:
                                  - text: 职位
                                  - textbox "材料候选职位" [ref=e419]: true | h1-internship
                                - generic [ref=e420]:
                                  - text: 开始日期
                                  - textbox "材料候选开始日期" [ref=e421]
                                - generic [ref=e422]:
                                  - text: 结束日期
                                  - textbox "材料候选结束日期" [ref=e423]
                                - generic [ref=e424]:
                                  - text: 说明
                                  - textbox "材料候选说明" [ref=e425]
                                - generic [ref=e426]: 修改保留为用户编辑，请采用此条后再正式确认。
                          - group [ref=e427]:
                            - generic "查看来源原文" [ref=e428] [cursor=pointer]
                          - generic [ref=e429]:
                            - button "上移" [ref=e430] [cursor=pointer]
                            - button "下移" [ref=e431] [cursor=pointer]
                            - button "合并" [ref=e432] [cursor=pointer]
                            - button "拆分" [ref=e433] [cursor=pointer]
                      - article [ref=e434]:
                        - generic [ref=e435]:
                          - generic [ref=e436]:
                            - checkbox "internship" [checked] [ref=e437]
                            - text: internship
                          - combobox "internship栏目类型" [ref=e438]:
                            - option "个人概述"
                            - option "教育经历"
                            - option "工作经历"
                            - option "实习经历" [selected]
                            - option "项目成果"
                            - option "奖项"
                            - option "技能"
                            - option "证书"
                            - option "语言"
                            - option "其他材料"
                            - option "旧版经历（需拆分）"
                            - option "其他/待确认"
                          - generic [ref=e439]:
                            - button "本栏目使用导入" [ref=e440] [cursor=pointer]
                            - button "本栏目保留现有" [ref=e441] [cursor=pointer]
                        - generic [ref=e442]:
                          - generic [ref=e443]:
                            - checkbox "AI 已识别 / 第 ? 页" [checked] [ref=e444]
                            - text: AI 已识别 / 第 ? 页
                          - generic [ref=e445]:
                            - generic [ref=e446]:
                              - term [ref=e447]: 组织
                              - definition [ref=e448]: 合成公司
                            - generic [ref=e449]:
                              - term [ref=e450]: 职位
                              - definition [ref=e451]: 开发实习生 | 参与产品测试与缺陷记录。
                            - generic [ref=e452]:
                              - term [ref=e453]: 编辑候选 / 补充信息
                              - definition [ref=e454]:
                                - generic [ref=e455]:
                                  - text: 组织
                                  - textbox "材料候选组织" [ref=e456]: 合成公司
                                - generic [ref=e457]:
                                  - text: 职位
                                  - textbox "材料候选职位" [ref=e458]: 开发实习生 | 参与产品测试与缺陷记录。
                                - generic [ref=e459]:
                                  - text: 开始日期
                                  - textbox "材料候选开始日期" [ref=e460]
                                - generic [ref=e461]:
                                  - text: 结束日期
                                  - textbox "材料候选结束日期" [ref=e462]
                                - generic [ref=e463]:
                                  - text: 说明
                                  - textbox "材料候选说明" [ref=e464]
                                - generic [ref=e465]: 修改保留为用户编辑，请采用此条后再正式确认。
                          - group [ref=e466]:
                            - generic "查看来源原文" [ref=e467] [cursor=pointer]
                          - generic [ref=e468]:
                            - button "上移" [ref=e469] [cursor=pointer]
                            - button "下移" [ref=e470] [cursor=pointer]
                            - button "合并" [ref=e471] [cursor=pointer]
                            - button "拆分" [ref=e472] [cursor=pointer]
                      - generic [ref=e473]:
                        - strong [ref=e474]: 未映射内容（1）
                        - paragraph [ref=e475]: 这些内容不会自动写入正式简历。可保留为来源记录，或选择不导入；原始来源文本仍保留。
                        - generic [ref=e476]:
                          - group [ref=e477]:
                            - generic "H1合成人物" [ref=e478]
                          - generic [ref=e479]:
                            - button "核对并保留来源" [ref=e480] [cursor=pointer]
                            - button "不导入此内容" [ref=e481] [cursor=pointer]
                  - generic [ref=e482]:
                    - generic [ref=e483]:
                      - strong [ref=e484]: 4 条已选内容
                      - generic [ref=e485]: 确认导入暂不可用：1 项未识别来源待核对 · 创建新人物：H1合成人物 · 已切换目标或用途，请重新核对并明确确认。
                    - generic [ref=e486]:
                      - button "取消" [ref=e487] [cursor=pointer]
                      - button "确认导入" [disabled] [ref=e488] [cursor=pointer]
        - article [ref=e489]:
          - generic [ref=e490]:
            - heading "简历中心" [level=2] [ref=e491]
            - generic [ref=e492]: （0 份当前简历 / 0 份已归档 / 0 份在回收站）
          - tablist "简历筛选" [ref=e493]:
            - tab "最近 0" [selected] [ref=e494] [cursor=pointer]
            - tab "全部 0" [ref=e495] [cursor=pointer]
            - tab "通用 0" [ref=e496] [cursor=pointer]
            - tab "岗位 0" [ref=e497] [cursor=pointer]
            - tab "归档 0" [ref=e498] [cursor=pointer]
            - tab "回收站 0" [ref=e499] [cursor=pointer]
          - paragraph [ref=e500]: 当前筛选下暂无简历。可以先导入已有简历，或在岗位工作区生成岗位建议草稿后创建。
  - region "操作通知"
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { readStore, installCoreWritingProvider } from "./support/p51CoreWorkflow";
  3  | 
  4  | test("H1 bundled Hermes analyze/save/compose/confirm/fit/refresh", async ({ page }, info) => {
  5  |  test.setTimeout(240_000);
  6  | 
  7  |  await page.goto("/setup");
  8  |  await expect.poll(async () => (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot?.apiReady, { timeout: 90_000 }).toBe(true);
  9  |  await page.getByLabel("API 密钥", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_KEY!);
  10 |  await page.getByLabel("API 地址", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_URL!);
  11 |  await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
  12 |  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  13 |  await expect(page).not.toHaveURL(/\/setup$/u, {timeout:30000});
  14 |  await page.goto("/resume");
  15 |  await page.getByRole("button", { name: "导入资料", exact: false }).click();
  16 |  const dialog = page.getByRole("dialog", { name: "导入资料", exact: true });
  17 |  await dialog.getByLabel("识别方式").selectOption("local");
  18 |  const material={schemaVersion:"careeradapt-resume-v2",locale:"zh-CN",basics:{name:"H1合成人物",portfolioLinks:[],otherLinks:[],customFields:[]},sections:[
  19 |   {id:"project",sectionType:"project",title:"项目经历",order:0,visible:true,items:[{id:"h1-project",sectionType:"project",title:"AI应用项目",role:"项目成员",description:"参与 AI 应用项目的需求梳理、原型设计和功能验收。",highlights:["参与 AI 应用项目的需求梳理、原型设计和功能验收。"],tools:[],outcomes:[],customFields:[]}]},
  20 |   {id:"internship",sectionType:"internship",title:"实习经历",order:1,visible:true,items:[{id:"h1-internship",sectionType:"internship",organization:"合成公司",role:"开发实习生",highlights:["参与产品测试与缺陷记录。"],tools:[],outcomes:[],customFields:[]}]}
  21 |  ],unclassifiedBlocks:[]};
  22 |  await dialog.getByLabel("选择职业材料").setInputFiles({name:"h1-profile.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(material))});
  23 |  await expect(dialog.locator("article.review-row").first()).toBeVisible();
  24 |  await dialog.getByText("创建新人物", {exact:true}).click();
  25 |  await dialog.locator('input[name="new-profile-name"]').fill("H1合成人物");
  26 |  const accept=dialog.getByRole("button",{name:"采用此条",exact:true});
  27 |  while(await accept.count()) await accept.first().click();
  28 |  await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
> 29 |  await dialog.getByRole("button",{name:"确认导入",exact:true}).click();
     |                                                            ^ Error: locator.click: Test timeout of 240000ms exceeded.
  30 |  await expect(dialog).not.toBeVisible();
  31 |  expect(await readStore(page,"resumeBranches")).toHaveLength(0);
  32 |  const before=await readStore(page,"profiles");
  33 |  await installCoreWritingProvider(page);
  34 |  await page.goto("/ai-workspace");
  35 |  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u,{timeout:90000});
  36 |  const send=async(text:string)=>{await page.getByLabel("描述你的求职任务").fill(text);await page.getByRole("button",{name:"发送消息",exact:true}).click();};
  37 |  const sessions=()=>readStore(page,"agentSessions");
  38 |  await send("分析这个岗位 JD：岗位：软件工程师；岗位职责：参与产品开发和测试；任职要求：本科及以上学历，熟悉 Python，具备项目开发与团队协作经验。");
  39 |  await expect.poll(async()=> (await sessions()).some(s=> (s.taskState as {workflowId?:string;completionStatus?:string})?.workflowId==="job_ingestion" && (s.taskState as {completionStatus?:string}).completionStatus==="completed"),{timeout:60000}).toBe(true);
  40 |  expect(await readStore(page,"jobDescriptions")).toHaveLength(0);
  41 |  await send("先保存该岗位，再进行岗位匹配分析");
  42 |  await expect.poll(async()=> (await readStore(page,"jobDescriptions")).length,{timeout:60000}).toBe(1);
  43 |  await expect(page.getByRole("button",{name:"发送消息",exact:true})).toBeEnabled({timeout:60000});
  44 |  await send("基于已确认的 Profile 创建一份通用简历，然后再做岗位匹配");
  45 |  await expect(page.getByRole("button",{name:"直接生成",exact:true}).last()).toBeVisible({timeout:60000});
  46 |  await page.reload();
  47 |  await page.getByRole("button",{name:"直接生成",exact:true}).last().click();
  48 |  await expect.poll(async()=> (await sessions()).some(s=> (s.taskState as {workflowId?:string;completionStatus?:string})?.workflowId==="analyze_job_fit" && (s.taskState as {completionStatus?:string}).completionStatus==="completed"),{timeout:60000}).toBe(true);
  49 |  await page.reload();
  50 |  const branches=await readStore(page,"resumeBranches");
  51 |  expect(branches).toHaveLength(1);expect(branches[0].branchPurpose).toBe("general");
  52 |  expect(await readStore(page,"jobDescriptions")).toHaveLength(1);
  53 |  expect(await readStore(page,"profiles")).toEqual(before);
  54 |  const final=await sessions();expect(JSON.stringify(final)).not.toMatch(/duplicate_invalid_call|jobId invalid_type|mode invalid/);
  55 |  await info.attach("h1-final",{body:JSON.stringify({branches,sessions:final}),contentType:"application/json"});
  56 | });
  57 | 
```