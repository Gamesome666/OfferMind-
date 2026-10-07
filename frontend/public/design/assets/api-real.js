/* ============================================================================
   OfferMind · 真实接入层
   ----------------------------------------------------------------------------
   作用：把 assets/app.js 里的模拟层（Om.api / Om.sse）覆盖成真实 HTTP 调用。
   引入顺序必须是 app.js 在前、本文件在后 —— 先定义再覆盖。

   前置：
     1. 后端已启动（uvicorn app.main:app --reload，:8000）
     2. 后端 CORS 已放行 localhost 任意端口（app/main.py 里已配）
     3. 页面与 assets/ 同源静态托管，或直接双击打开（file:// 会因 CORS 失败）

   页面里唯一需要改的：所有 Om.api(...) 调用处加 await，
   所有 Om.sse(script, ...) 调用处改成 Om.sse(path, { body, ...handlers })。
   ========================================================================== */
(function () {
  if (!window.Om) {
    console.error("[api-real] 必须先引入 assets/app.js");
    return;
  }

  const BASE = (window.OM_API_BASE || "http://127.0.0.1:8000") + "/api/v1";

  /* ---------------------------------------------------------- 令牌 */
  const TK = "om_token";
  Om.auth = {
    get token() {
      return localStorage.getItem(TK) || "";
    },
    set token(v) {
      if (v) localStorage.setItem(TK, v);
      else localStorage.removeItem(TK);
    },
    header() {
      const t = this.token;
      return t ? { Authorization: "Bearer " + t } : {};
    },
  };

  /** "/api/v1/answers/due" + {limit:50} → "http://127.0.0.1:8000/api/v1/answers/due?limit=50" */
  function buildUrl(path, query) {
    const p = String(path).replace(/^\/api\/v1/, "");
    const u = new URL(BASE + p);
    if (query) {
      for (const k of Object.keys(query)) {
        const v = query[k];
        if (v !== "" && v !== null && v !== undefined) u.searchParams.set(k, v);
      }
    }
    return u.toString();
  }

  /* ---------------------------------------------------------- Om.api */
  /**
   * 与模拟层同签名，但返回 Promise。
   * 401 时清令牌并跳登录页；其余非 2xx 抛错，错误对象带 .status / .data，
   * 页面可以 catch 后 Om.toast("err", ...) 提示，detail 直接就是后端的中文 detail。
   */
  Om.api = async function (method, path, body) {
    const [p, qs] = String(path).split("?");
    const query = {};
    if (qs) new URLSearchParams(qs).forEach((v, k) => (query[k] = v));

    const init = { method, headers: Object.assign({}, Om.auth.header()) };
    if (body instanceof FormData) {
      // 不要手工设 Content-Type，浏览器要自己补 multipart 的 boundary
      init.body = body;
    } else if (body !== undefined && body !== null) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const res = await fetch(buildUrl(p, query), init);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text; // 非 JSON 响应原样返回，便于排查
    }

    if (!res.ok) {
      const detail = (data && data.detail) || res.statusText || "请求失败";
      if (res.status === 401) {
        Om.auth.token = "";
        if (!/login\.html$/.test(location.pathname)) location.href = "login.html";
      }
      const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  /* ---------------------------------------------------------- Om.sse */
  /**
   * 真实流式。签名与模拟层不同，因为模拟层的「脚本数组」在真实场景没有对应物。
   *
   *   Om.sse("/api/v1/training/question/stream",
   *          { body: {direction, difficulty, question_type, weak_points},
   *            onEvent, onToken, onDone, onError })
   *   返回 () => void，可随时中止。
   *
   * 为什么不用 EventSource：9 条流式端点全是 POST，EventSource 只能发 GET。
   * 这里用 fetch + ReadableStream 手工切帧，对齐后端 app/api/sse.py 的
   * `data: {...}\n\n` 格式，末尾的 `data: [DONE]` 是终止标记。
   */
  Om.sse = function (path, opts) {
    const o = opts || {};
    const ctrl = new AbortController();

    (async () => {
      let res;
      try {
        // 多数流式端点是 JSON；/resume/parse/stream 是 multipart（要传 PDF），
        // 那种情况下不能设 Content-Type —— boundary 得由浏览器补。
        const isForm = o.body instanceof FormData;
        const headers = isForm
          ? Object.assign({}, Om.auth.header())
          : Object.assign({ "Content-Type": "application/json" }, Om.auth.header());
        res = await fetch(buildUrl(path), {
          method: "POST",
          headers,
          body: o.body === undefined ? undefined : isForm ? o.body : JSON.stringify(o.body),
          signal: ctrl.signal,
        });
      } catch (e) {
        if (e.name !== "AbortError" && o.onError) o.onError({ type: "错误", payload: { message: String(e) } });
        return;
      }

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        if (res.status === 401) Om.auth.token = "";
        if (o.onError) o.onError({ type: "错误", payload: { message: `HTTP ${res.status} ${t}` } });
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });

          const frames = buf.split("\n\n");
          buf = frames.pop(); // 最后一段可能被截断，留到下一轮再拼

          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const raw = line.slice(5).trim();
            if (raw === "[DONE]") {
              if (o.onDone) o.onDone();
              return;
            }

            let ev;
            try {
              ev = JSON.parse(raw);
            } catch {
              continue; // 坏帧跳过，不断流
            }

            // 三类事件分开走：token 拼气泡，结果/错误是终态信号，其余是步骤事件。
            // 注意「结果」之后后端还可能补推「已记录」，所以它不作为终止条件。
            if (ev.type === "token") {
              if (o.onToken) o.onToken(ev.payload.text, ev);
            } else if (ev.type === "错误") {
              if (o.onEvent) o.onEvent(ev);
              if (o.onError) o.onError(ev);
              return;
            } else {
              if (o.onEvent) o.onEvent(ev);
            }
          }
        }
        if (o.onDone) o.onDone();
      } catch (e) {
        if (e.name !== "AbortError" && o.onError) o.onError({ type: "错误", payload: { message: String(e) } });
      }
    })();

    return function abort() {
      ctrl.abort();
    };
  };

  /* ---------------------------------------------------------- 上传 */
  /** PDF 上传走 multipart，不能走 JSON 分支。 */
  Om.upload = function (path, file) {
    const fd = new FormData();
    fd.append("file", file);
    return Om.api("POST", path, fd);
  };

  /* ---------------------------------------------------------- 等待流式完成 */
  /**
   * Om.sse 是「发出去就不管」，返回中止函数。但简历诊断、面试多轮这类流程需要
   * 「等这一步跑完再决定下一步」，所以要一个 Promise 版本。
   *
   *   const out = await Om.sseAsync("/api/v1/resume/parse/stream",
   *                                 { body: fd, onEvent: (ev) => trace.push(ev) });
   *   // out 就是「结果」事件的 payload；失败时 reject
   *
   * 与 Om.sse 一样，body 传 FormData 时不设 Content-Type（boundary 要浏览器补）。
   */
  Om.sseAsync = function (path, opts) {
    const o = opts || {};
    return new Promise((resolve, reject) => {
      let result = null;
      Om.sse(path, {
        body: o.body,
        onToken: o.onToken,
        onEvent: (ev) => {
          if (o.onEvent) o.onEvent(ev);
          if (ev.type === "结果") result = ev.payload;
        },
        onDone: () => resolve(result),
        onError: (ev) =>
          reject(new Error((ev && ev.payload && ev.payload.message) || "流式请求失败")),
      });
    });
  };

  /* ---------------------------------------------------------- 侧栏角标 */
  /**
   * 侧栏上「错题本」那个待复习角标，Om.rail 渲染时读的是模拟数据里的 Om.DB，
   * 接入真实后端后那个数字是错的。页面拿到 /answers/stats 之后调一次即可修正：
   *
   *   const s = await Om.api("GET", "/api/v1/answers/stats");
   *   Om.setBadge("due", s.due);
   */
  Om.setBadge = function (key, n) {
    if (key !== "due") return;
    const link = document.querySelector('.rail-link[href="wrongbook.html"]');
    const el = link && link.querySelector(".badge-n");
    if (!el) return;
    el.textContent = n;
    el.style.display = n ? "" : "none";
  };

  /* ---------------------------------------------------------- 登录 */
  /** 登录后把令牌存下来，返回当前用户；页面据此决定是否显示「管理后台」入口。 */
  Om.login = async function (email, password) {
    const t = await Om.api("POST", "/api/v1/auth/login", { email, password });
    Om.auth.token = t.access_token;
    return Om.api("GET", "/api/v1/auth/me");
  };

  /* ---------------------------------------------------------- 回归自检 */
  /** 控制台里跑 OmReal.check() 可确认后端连通性与端点数量。 */
  window.OmReal = {
    BASE,
    async check() {
      const h = await Om.api("GET", "/api/v1/health");
      const r = await Om.api("GET", "/api/v1/health/ready");
      const n = (window.Om.ENDPOINTS || []).length;
      console.table({ health: h.status, ready: r.status, endpoints: n });
      return { h, r, n };
    },
  };

  console.info("[api-real] 已接管 Om.api / Om.sse，目标 " + BASE);
})();
