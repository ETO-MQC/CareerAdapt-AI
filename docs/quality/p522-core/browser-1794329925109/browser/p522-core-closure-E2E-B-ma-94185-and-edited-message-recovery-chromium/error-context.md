# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p522-core-closure.spec.ts >> E2E-B: material edit/reject, refresh confirmation, Agent stop and edited-message recovery
- Location: tests\e2e\p522-core-closure.spec.ts:58:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.agent-message-row.is-assistant').last()
Expected substring: "P522 当前资料已读取"
Received string:    "正在处理当前任务已用时 1 分 29 秒进行中正在思考正在思考"
Timeout: 90000ms

Call log:
  - Expect "toContainText" with timeout 90000ms
  - waiting for locator('.agent-message-row.is-assistant').last()
    5 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 0 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 2 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 3 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 4 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 5 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 6 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 7 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 8 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 9 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 10 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 11 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 12 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 13 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 14 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 15 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 16 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 17 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 18 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 19 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 20 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 21 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 22 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 23 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 24 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 25 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 26 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 27 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 28 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 29 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 30 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 31 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 32 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 33 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 34 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 35 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 36 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 37 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 38 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 39 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 40 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 41 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 42 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 43 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 44 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 45 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 46 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 47 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 48 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 49 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 50 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 51 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 52 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 53 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 54 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 55 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 56 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 57 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 58 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 59 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 0 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 1 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 2 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 3 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 4 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 5 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 1 分 6 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 7 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 8 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 9 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 10 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 11 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 1 分 12 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 13 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 14 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 15 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 16 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 17 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 1 分 18 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 19 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 20 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 21 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 22 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 23 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 1 分 24 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 25 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 26 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 27 秒进行中正在思考正在思考"
    2 × locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
      - unexpected value "正在处理当前任务已用时 1 分 28 秒进行中正在思考正在思考"
    - locator resolved to <article data-message-role="assistant" data-message-status="thinking" class="agent-message-row is-assistant is-streaming" data-message-id="agent-thinking-d961146b-b09d-43c2-ad21-57c8b3737246">…</article>
    - unexpected value "正在处理当前任务已用时 1 分 29 秒进行中正在思考正在思考"

```

```yaml
- article:
  - group "任务过程":
    - status "正在处理当前任务 已用时 1 分 29 秒":
      - strong: 正在处理当前任务
      - text: 已用时 1 分 29 秒
    - list:
      - listitem:
        - strong: 进行中
        - text: 正在思考
  - status: 正在思考
  - button "重新生成" [disabled]
  - button "基于此继续" [disabled]
  - button "复制消息" [disabled]
```

# Test source

```ts
  6   | async function setup(page: Page) {
  7   |   await page.goto("/setup");
  8   |   await expect.poll(async () => (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot?.apiReady, { timeout: 90_000 }).toBe(true);
  9   |   await page.getByLabel("API 密钥", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_KEY!);
  10  |   await page.getByLabel("API 地址", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_URL!);
  11  |   await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
  12  |   await page.getByRole("button", { name: "开始使用", exact: true }).click();
  13  |   await expect(page).not.toHaveURL(/\/setup$/u, { timeout: 90_000 });
  14  | }
  15  | 
  16  | async function snapshot(page: Page): Promise<Record<string, Array<Record<string, unknown>>>> {
  17  |   return Object.fromEntries(await Promise.all(["profiles", "resumeBranches", "resumeRevisions", "jobDescriptions", "exportRecords"].map(async name => [name, await readStore(page, name)])));
  18  | }
  19  | 
  20  | test("E2E-A: official import, General PDF, Job A and Job B confirmed revisions remain isolated", async ({ page }, info) => {
  21  |   test.setTimeout(300_000);
  22  |   await setup(page);
  23  |   await prepareCoreSourceResume(page);
  24  |   const general = (await readStore(page, "resumeBranches")).find(b => b.branchPurpose === "general")!;
  25  |   expect(general).toBeTruthy();
  26  |   const baseline = await snapshot(page);
  27  |   await verifyCoreResumePdf(page, String(general.id));
  28  |   await info.attach("general-preview", { body: await page.screenshot(), contentType: "image/png" });
  29  |   let previous: Awaited<ReturnType<typeof snapshot>> | undefined;
  30  |   for (const suffix of ["A", "B"]) {
  31  |     await page.goto("/jobs");
  32  |     await page.getByTestId("job-title-input").fill(`AI 应用开发 P522-${suffix}`);
  33  |     await page.getByTestId("job-company-input").fill(`合成公司 ${suffix}`);
  34  |     await page.getByTestId("job-raw-textarea").fill(`岗位：AI 应用开发 P522-${suffix}\n岗位职责\n1. 参与 AI 应用需求梳理和功能验收。\n任职要求\n1. 熟悉 Python 或 SQL。\n2. 团队协作能力优先。`);
  35  |     await page.getByTestId("save-job-raw-input").click();
  36  |     await page.getByTestId("job-manual-mode-dialog").click();
  37  |     const dialog = page.getByRole("dialog");
  38  |     const checks = dialog.getByRole("checkbox");
  39  |     for (let i = 0; i < await checks.count(); i++) await checks.nth(i).check();
  40  |     await dialog.getByTestId("commit-job").click();
  41  |     await expect(page.getByTestId("conversion-result")).toBeVisible();
  42  |     const job = (await readStore(page, "jobDescriptions")).find(j => String(j.title).includes(`P522-${suffix}`))!;
  43  |     await completeCoreResumeWorkflow(page, String(job.id));
  44  |     const after = await snapshot(page);
  45  |     expect(after.profiles).toEqual(baseline.profiles);
  46  |     expect(after.resumeBranches.find(b => b.id === general.id)).toEqual(general);
  47  |     if (previous) {
  48  |       for (const branch of previous.resumeBranches) expect(after.resumeBranches.find(b => b.id === branch.id)).toEqual(branch);
  49  |       for (const revision of previous.resumeRevisions) expect(after.resumeRevisions.find(r => r.id === revision.id)).toEqual(revision);
  50  |     }
  51  |     previous = after;
  52  |     await info.attach(`job-${suffix}-preview`, { body: await page.screenshot(), contentType: "image/png" });
  53  |   }
  54  |   expect(previous!.resumeBranches.filter(b => b.profileId === general.profileId)).toHaveLength(3);
  55  |   await info.attach("business-before-after", { body: JSON.stringify({ baseline, after: previous }, null, 2), contentType: "application/json" });
  56  | });
  57  | 
  58  | test("E2E-B: material edit/reject, refresh confirmation, Agent stop and edited-message recovery", async ({ page }, info) => {
  59  |   test.setTimeout(240_000);
  60  |   await setup(page);
  61  |   await page.goto("/resume");
  62  |   const open = async () => {
  63  |     await page.getByRole("button", { name: "导入资料", exact: false }).click();
  64  |     return page.getByRole("dialog", { name: "导入资料", exact: true });
  65  |   };
  66  |   let dialog = await open();
  67  |   await dialog.getByLabel("识别方式").selectOption("local");
  68  |   const material = { schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { portfolioLinks: [], otherLinks: [], customFields: [] }, sections: [
  69  |     { id: "cert", sectionType: "certificates", title: "证书", order: 0, visible: true, items: [{ id: "cert1", sectionType: "certificates", name: "P522 合成资格证书", issuer: "原机构", customFields: [] }] },
  70  |     { id: "award", sectionType: "awards", title: "奖项", order: 1, visible: true, items: [{ id: "award1", sectionType: "awards", name: "不应入库奖项", customFields: [] }] }
  71  |   ], unclassifiedBlocks: [] };
  72  |   await dialog.getByLabel("选择职业材料").setInputFiles({ name: "p522-material.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(material)) });
  73  |   await expect(dialog.getByLabel("材料候选证书名称")).toHaveValue("P522 合成资格证书");
  74  |   const before = await snapshot(page);
  75  |   await dialog.getByText("创建新人物", { exact: true }).click();
  76  |   await dialog.locator('input[name="new-profile-name"]').fill("P522 合成人物");
  77  |   const certificate = () => dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="证书栏目类型"]') });
  78  |   const issuer = certificate().getByLabel("材料候选颁发方", { exact: true });
  79  |   await issuer.fill("人工核对机构"); await issuer.blur();
  80  |   await dialog.getByRole("button", { name: "采用此条", exact: true }).click();
  81  |   await dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="奖项栏目类型"]') }).locator('input[name$="-included"]').last().uncheck();
  82  |   expect(await snapshot(page)).toEqual(before);
  83  |   await page.reload(); dialog = await open();
  84  |   await expect(certificate().getByLabel("材料候选颁发方", { exact: true })).toHaveValue("人工核对机构");
  85  |   await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
  86  |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  87  |   await expect(dialog).not.toBeVisible();
  88  |   await page.reload();
  89  |   const saved = await snapshot(page);
  90  |   expect(saved.resumeBranches).toEqual(before.resumeBranches);
  91  |   expect(saved.resumeRevisions).toEqual(before.resumeRevisions);
  92  |   const profile = saved.profiles.find(p => p.name === "P522 合成人物")!;
  93  |   expect(JSON.stringify(profile)).toContain("人工核对机构");
  94  |   expect(JSON.stringify(profile)).not.toContain("不应入库奖项");
  95  |   await page.goto("/ai-workspace");
  96  |   await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 90_000 });
  97  |   await page.getByLabel("描述你的求职任务").fill("P512-QUEUE-FIRST P522-STOP-A 读取当前资料，不要修改。");
  98  |   await page.getByRole("button", { name: "发送消息", exact: true }).click();
  99  |   const sessions = () => readStore(page, "agentSessions");
  100 |   await expect.poll(async () => (await sessions()).some(s => (s.hermesRun as { status?: string })?.status === "running"), { timeout: 60_000 }).toBe(true);
  101 |   await page.getByRole("button", { name: "停止运行", exact: true }).click();
  102 |   await expect(page.getByRole("button", { name: "停止运行", exact: true })).toHaveCount(0);
  103 |   await page.getByRole("button", { name: "编辑并重发", exact: true }).last().click();
  104 |   await page.getByLabel("编辑消息", { exact: true }).fill("P522-EDIT-B 读取当前资料，仅概览。");
  105 |   await page.getByRole("button", { name: "确认并重发", exact: true }).click();
> 106 |   await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("P522 当前资料已读取", { timeout: 90_000 });
      |                                                                        ^ Error: expect(locator).toContainText(expected) failed
  107 |   await page.reload();
  108 |   await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("P522 当前资料已读取");
  109 |   expect(await snapshot(page)).toEqual(saved);
  110 |   await info.attach("material-agent-before-after", { body: JSON.stringify({ before, saved, sessions: await sessions() }, null, 2), contentType: "application/json" });
  111 |   await info.attach("recovered-workspace", { body: await page.screenshot(), contentType: "image/png" });
  112 | });
  113 | 
```