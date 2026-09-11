# P4.8c.1 same-profile resume acceptance

Synthetic confirmed profile; deterministic production compiler and WorkspaceRepository. These are test artifacts, not live model output.

All three branches retain the same four source bullets and identical factRefs. Profile readback is unchanged. AI prioritizes retrieval; backend prioritizes service/API/Redis. No invented metric or ownership upgrade.

## General

Branch purpose: `general`.

### 验证项目0

- 参与检索链路开发，使用混合检索与重排序处理文档查询，通过离线评测集验证召回。

Source facts: fact-0

### 验证项目1

Tools: Redis

- 参与订单服务开发，使用 Redis 缓存会话状态，通过 API 接口交付数据查询。

Source facts: fact-1

### 验证项目2

- 参与会话页面开发，封装组件与状态管理，通过渲染测试验证交互复用。

Source facts: fact-2

### 验证项目3

- 参与部署流程开发，配置双机热备与健康检查，通过故障切换演练验证恢复。

Source facts: fact-3

## ai

Branch purpose: `job_specific`.

### 验证项目0

- 参与检索链路开发，使用混合检索与重排序处理文档查询，通过离线评测集验证召回。

Source facts: fact-0

### 验证项目1

Tools: Redis

- 参与订单服务开发，使用 Redis 缓存会话状态，通过 API 接口交付数据查询。

Source facts: fact-1

### 验证项目2

- 参与会话页面开发，封装组件与状态管理，通过渲染测试验证交互复用。

Source facts: fact-2

### 验证项目3

- 参与部署流程开发，配置双机热备与健康检查，通过故障切换演练验证恢复。

Source facts: fact-3

## backend

Branch purpose: `job_specific`.

### 验证项目1

Tools: Redis

- 参与订单服务开发，使用 Redis 缓存会话状态，通过 API 接口交付数据查询。

Source facts: fact-1

### 验证项目2

- 参与会话页面开发，封装组件与状态管理，通过渲染测试验证交互复用。

Source facts: fact-2

### 验证项目3

- 参与部署流程开发，配置双机热备与健康检查，通过故障切换演练验证恢复。

Source facts: fact-3

### 验证项目0

- 参与检索链路开发，使用混合检索与重排序处理文档查询，通过离线评测集验证召回。

Source facts: fact-0

## Catalog and boundary checks

A separate controlled WritingService response fixture compresses a 20-tool project row to eight display tools; the original Profile, its facts, and the evidence bullet remain unchanged. The strict outgoing task schema accepts the request and retains bounded maturity guidance.

See `p48c-same-profile.json` for complete branch/revision-linked data and `p48c-gates.json` for gate outcomes.
