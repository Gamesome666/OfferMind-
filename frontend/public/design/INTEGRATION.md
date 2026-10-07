# OfferMind 前端设计 → 后端接入交接说明

> 给 Claude Code 的任务简报。把这个文件放到你的仓库根目录，连同设计文件一起。

## 0. 要做什么

把这套静态设计（13 个 HTML 页面 + 1 个 1920×1080 大屏）接到已经跑通的 FastAPI 后端上。
后端不需要改动 —— 47 个端点已实现，CORS 已放行。

## 1. 文件清单

```
设计文件（来自 Open Design）
├── index.html                 首页（暗色首屏 + 检索星图交互）
├── login.html                 登录 / 注册
├── dashboard.html             工作台
├── practice.html              刷题训练（出题 / 四维评分 / 追问 + 可观测面板）
├── wrongbook.html             错题本 + SM-2 复习
├── resume.html                简历诊断
├── interview.html             模拟面试（token 流式对话）
├── report.html                能力报告 + 能力画像
├── admin.html                 后台概览 + 用户管理
├── admin-questions.html       题库管理
├── admin-config.html          模型与检索配置
├── admin-api.html             接口总览 + 请求调试台
├── bigscreen.html             1920×1080 数据大屏
└── assets/
    ├── tokens.css             设计令牌 + 组件基类（全部页面共用）
    ├── app.js                 模拟 API 层 + SSE 模拟 + 展示组件（雷达/评分条/toast/modal…）
    └── api-real.js            真实接入层（本次新增，覆盖前两者的数据部分）
```

## 2. 核心事实：只有一个收口

**13 个页面没有任何一处自己 `fetch`。** 所有数据请求都经过 `assets/app.js` 里的两个函数：

| 模拟函数 | 职责 | 被调用处 |
|---|---|---|
| `Om.api(method, path, body)` | 全部 47 个端点的请求 | 31 处 |
| `Om.sse(path, opts)` | 9 条 SSE 流式端点 | 8 处 |

`assets/api-real.js` 已经把这两个函数实现成真实 HTTP（fetch + ReadableStream），
**引入顺序决定了谁生效：`app.js` 在前，`api-real.js` 在后。**

```html
<script src="assets/app.js"></script>
<script src="assets/api-real.js"></script>   <!-- 加这一行，模拟层即被覆盖 -->
```

`Om.rail`（侧栏）、`Om.radar`（雷达图）、`Om.rubric`（评分条）、`Om.toast`、
`Om.modal`、`Om.confirm`、`Om.tracePanel`、`Om.bindTrace`、`Om.relDay`
都是纯展示组件，**不需要改，继续用**。

## 3. 唯一的真实成本：同步 → 异步

模拟层同步返回，真实网络是异步的。所有调用处必须加 `await`：

```js
// 改前（模拟层，同步）
const stats = Om.api("GET", "/api/v1/answers/stats");
document.getElementById("k-due").textContent = stats.due;

// 改后（真实，异步）
const stats = await Om.api("GET", "/api/v1/answers/stats");
document.getElementById("k-due").textContent = stats.due;
```

页面脚本都是 IIFE 或模块顶层，包一层 `async` 即可：

```js
(async function () {
  Om.mount("dashboard");
  const stats = await Om.api("GET", "/api/v1/answers/stats");
  /* … */
})();
```

## 4. SSE 调用处的改法（会变简单）

模拟层的 SSE 调用长这样 —— 页面里手搓了一个假的事件脚本：

```js
// 改前：页面里手搓事件脚本（这些全删）
const defs = [{ id: "embed:q", type: "检索", payload: {...}, ms: 63 }, ...];
Om.sse(script(defs, res), { onEvent: (ev) => trace.push(ev), onDone: ... }, 1.6);
```

接后端后，直接传真实请求体（`script()` / `Om.steps()` 这类辅助函数全部删掉）：

```js
// 改后：一行
Om.sse("/api/v1/training/question/stream",
  {
    body: { direction: $("#dir").value, difficulty: $("#diff").value,
            question_type: $("#type").value, weak_points: $("#weak").value },
    onEvent: (ev) => trace.push(ev),
    onToken: (text, ev) => { /* 面试页才用：拼气泡 */ },
    onDone:  () => { /* 收尾：解锁按钮、渲染结果 */ },
    onError: (ev) => Om.toast("err", "失败", ev.payload.message),
  });
```

返回值是 `() => void`（abort），需要时可中止。

## 5. 逐页迁移清单

| 文件 | 要改什么 |
|---|---|
| `login.html` | 把假的账号校验换成 `await Om.login(email, pw)`；成功后跳 `dashboard.html` |
| `dashboard.html` | 4 个 GET 加 `await`（stats / due / history / profile） |
| `practice.html` | 3 处 SSE 改成真实调用；**出题结果里的 `question_id` 要存下来，评分时回传**（不回传则不落库，错题本和微调数据集都收不到数据） |
| `wrongbook.html` | 加 `await`；**删掉 `Om.DB.questions.find(...)` 的题干查找** —— `/answers` 响应里已经 join 了 `question_content` |
| `resume.html` | 上传改 `Om.upload("/api/v1/resume/parse/stream", file)`（multipart SSE，`api-real.js` 已处理）；诊断走 JSON |
| `interview.html` | `session_id` 第一轮传 `null` 开新会话，之后每轮带上；结束传 `summarize: true` 出报告 |
| `report.html` | 加 `await`；画像雷达数据来自 `GET /report/profile` |
| `admin*.html` | 加 `await`；非管理员会收到 403，`api-real.js` 会抛错，页面 catch 后提示即可 |
| `admin-api.html` | 调试台本身就是开发者工具，接后端后可直接发真实请求 |
| `bigscreen.html` | 大屏是演示态，可继续用固定数据；若要接真实数据，读 `/admin/stats` + `/answers/stats` |
| `index.html` | 首页的检索星图是**纯前端交互演示**，不请求后端，不用改 |

## 6. 已知的坑（都是实际会撞上的）

1. **不能用 `EventSource`。** 9 条流式端点全是 POST，`EventSource` 只能发 GET。
   必须用 `fetch` + `res.body.getReader()` 手工切帧 —— `api-real.js` 已经这么做了。
2. **`/resume/parse/stream` 是 multipart + SSE 的组合。** 传 PDF 用 `FormData`，
   且不能手工设 `Content-Type`（boundary 要浏览器补）。
3. **`file://` 直接双击打开会 CORS 失败。** 必须静态托管（`npx serve`、`python -m http.server`
   或丢进 Next 的 `public/`）。
4. **`/answers` 已经联表带出题干。** 前端不用再为每条记录查一次题目。
5. **评分必须回传 `question_id`。** 后端设计是「宁可不记录，也不要挂到错的题上」。
6. **流末尾是 `data: [DONE]`。** 不要拿它当 JSON 解析。
7. **「结果」事件不是终点。** 评分链路里 `结果` 之后还会补推一条 `已记录`（带 `answer_id`），
   前端拿它跳错题本或标收藏 —— `api-real.js` 里已按这个语义处理。
8. **字段名以 `/docs` 为准核对一遍。** 模拟层的数据结构是按你的 pydantic schema 写的，
   主要输出（`GradeOutput` / `ResumeOutput` / `JDOutput` / `DiagnoseOutput` /
   `InterviewReportOutput` / `TrainingReportOutput`）字段名一致，但接的时候建议
   开 `http://127.0.0.1:8000/docs` 逐个对一遍，以实际响应为准。

## 7. 两条路线，先选一条

### 路线 A：保留静态页面，套上真实接口（推荐先做这个）

- **工作量**：小。改 8 个页面的 `await`，删掉 SSE 的假脚本。
- **得到**：一份能连真实后端、能跑通全链路的可演示系统。答辩演示够用。
- **落地位置**：`frontend/public/design/`，或单独一个静态目录。
- **代价**：与现有 Next.js 应用并存，是两个前端。

### 路线 B：把设计移植进现有 Next.js 应用

- **工作量**：中。`assets/tokens.css` 直接进 `app/globals.css`（它就是一套纯 CSS 令牌 +
  组件类，不依赖任何框架）；每个 HTML 页面的 `<body>` 结构改写成 React 组件；
  数据层换成你已经写好的 `lib/api.ts`（**它已经是 fetch + getReader 的真实实现，
  包括 SSE 切帧，直接用**）。
- **得到**：一个前端。真实路由、真实鉴权、`next dev` 热更新。
- **代价**：13 个页面逐个搬。

**建议：先走 A 拿到可用演示，再按页面重要性逐步走 B。** 两件事互不冲突 ——
A 阶段的 `api-real.js` 里那套 URL 拼装、令牌注入、SSE 切帧逻辑，
搬到 Next 里就是 `lib/api.ts` 的等价物，可以直接参考。

## 8. 可以直接复制给 Claude Code 的提示词

```
这个仓库里新增了一套前端设计稿，目录在 <设计文件所在目录>。
请把它接到已有的 FastAPI 后端上。

背景（已经确认过的事实，不用重新调研）：
- 后端 47 个端点已实现，CORS 已放行 localhost 任意端口
- 设计稿里所有页面共用 assets/tokens.css（纯 CSS 令牌 + 组件类，无框架依赖）
- 所有数据请求都经过 assets/app.js 的 Om.api(method, path, body) 和 Om.sse(path, opts)
  两个函数，页面里没有任何一处自己 fetch，共 31 处 Om.api、8 处 Om.sse
- assets/api-real.js 已经把这两个函数实现成真实 fetch + ReadableStream，
  引入顺序 app.js → api-real.js 即可覆盖

请按路线 A 执行：
1. 给 8 个页面（login/dashboard/practice/wrongbook/resume/interview/report/admin*）
   的脚本包一层 async IIFE，所有 Om.api 调用加 await
2. 删掉各页面里手搓的 SSE 假事件脚本（script() 辅助函数），改成
   Om.sse("/api/v1/xxx/stream", { body, onEvent, onToken, onDone, onError })
3. login.html 改用 Om.login(email, password)
4. wrongbook.html 删掉 Om.DB.questions.find(...) 的题干查找（/answers 已联表带出）
5. practice.html 记住出题返回的 question_id，评分时回传
6. 起后端（uvicorn app.main:app --reload）和静态服务，逐页验证跑通

约束：
- 不要改 assets/tokens.css 和 assets/app.js 里的展示组件（Om.rail / Om.radar /
  Om.rubric / Om.toast / Om.modal / Om.confirm / Om.tracePanel / Om.bindTrace）
- 不要用 EventSource（流式端点都是 POST），继续用 api-real.js 的 fetch 实现
- 遇到字段对不上，以 http://127.0.0.1:8000/docs 的实际响应为准，并告诉我
- 每改完一个页面就实际跑一遍，别一次性改完再测

先给我一个执行计划，确认后开工。
```

## 9. 验证清单

跑通的标准（逐条验，别跳）：

- [ ] `OmReal.check()` 在控制台返回 `{health:"ok", ready:"ready", endpoints:47}`
- [ ] 登录 → 拿到令牌 → 刷新页面仍在登录态
- [ ] 刷题页：出题有逐步事件（不是一次性出结果）→ 作答 → 四维评分 → 落库后出现 `answer_id`
- [ ] 错题本：能看到刚才那次作答，SM-2 复习一次后下次复习时间变了
- [ ] 面试页：HR 回复逐字出现（token 流式），总结能出报告
- [ ] 简历页：传 PDF 能出结构化结果 + 匹配度
- [ ] 后台：非管理员访问 `admin.html` 被挡（403）
