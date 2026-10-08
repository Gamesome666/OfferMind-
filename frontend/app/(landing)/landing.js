/* 落地页的交互脚本。提取自设计稿 index.html 的内联 <script>。

   逻辑与设计稿逐字一致，未做任何改写。仅有的两处包装：
   1. 整体包进 `initLanding()`，由 React 在 useEffect 里调用；
   2. 初始化期间临时包一层 addEventListener，把 AbortSignal 注入所有监听器，
      卸载时 abort() 一次性摘除（脚本里有单行也有多行回调，逐个注入容易漏）。

   注意：其中「检索星图」那段是 Canvas 动画，用 React 惯用法重写只会引入行为漂移，
   它本身不读写 React 状态，所以按原样保留。
*/

export function initLanding() {
  const ac = new AbortController();
  const { signal } = ac;

  const origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (opts && typeof opts === "object") {
      origAdd.call(this, type, fn, { ...opts, signal });
    } else {
      origAdd.call(this, type, fn, { capture: !!opts, signal });
    }
  };

  try {
      /* ============================================================================
         一、检索星图
         ----------------------------------------------------------------------------
         光标即查询向量：与节点距离 d 决定它是否被召回（d < R），
         召回的节点按 d 升序取前 5 条作为「精排保留」。
         相似度是 d 的真实函数（sim = 0.99 − d/R × 0.42），不是写死的数字。
         ========================================================================== */
      (function () {
        const cv = document.getElementById("sky");
        if (!cv) return;
        const ctx = cv.getContext("2d");
        const hero = document.getElementById("hero");

        // 真实考点：取自题库的方向与考点，不是随手编的标签
        const TOPICS = [
          "MySQL 索引最左前缀", "覆盖索引与回表", "索引下推 ICP", "事务隔离级别", "MVCC 多版本并发",
          "分库分表跨库分页", "慢查询定位路径", "Redis 缓存穿透", "Redis 缓存击穿", "Redis 缓存雪崩",
          "布隆过滤器", "分布式锁与续期", "LRU 缓存实现", "两数之和", "有效括号序列",
          "双向链表与哈希表", "进程与线程的区别", "协程与用户态调度", "死锁的四个条件", "虚拟内存与缺页",
          "HTTPS 握手过程", "对称与非对称加密", "TCP 三次握手", "TCP 拥塞控制", "HTTP 缓存策略",
          "浏览器事件循环", "宏任务与微任务", "重排与重绘", "短链服务设计", "发号器选型",
          "热点 key 处理", "限流与熔断", "消息队列幂等", "幂等与去重表", "CAP 与最终一致",
          "B+ 树与聚簇索引", "Explain 执行计划", "连接池与超时", "GC 与内存泄漏", "线程池参数",
        ];

        let W = 0, H = 0, DPR = 1;
        const NODES = [];
        let ambientWeb = [];
        const pointer = { x: 0, y: 0, tx: 0, ty: 0, active: false, lastMove: 0 };
        const ripples = [];
        let rafId = 0, running = false, frame = 0;
        const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

        function seed() {
          NODES.length = 0;
          // 密度跟着面积走，小屏不糊、大屏不空
          const n = Math.max(58, Math.min(132, Math.round((W * H) / 13500)));
          for (let i = 0; i < n; i++) {
            NODES.push({
              x: Math.random() * W,
              y: Math.random() * H,
              vx: (Math.random() - 0.5) * 0.16,
              vy: (Math.random() - 0.5) * 0.16,
              r: 0.9 + Math.random() * 1.5,
              topic: TOPICS[i % TOPICS.length],
              ph: Math.random() * Math.PI * 2, // 呼吸相位
            });
          }
          pointer.x = pointer.tx = W * 0.66;
          pointer.y = pointer.ty = H * 0.46;
        }

        function resize() {
          const r = hero.getBoundingClientRect();
          // 尺寸没实质变化就不重新播种 —— 否则拖动窗口边缘会把星图整片重掷
          if (NODES.length && Math.abs(r.width - W) < 2 && Math.abs(r.height - H) < 2) return;
          DPR = Math.min(2, window.devicePixelRatio || 1);
          W = r.width; H = r.height;
          cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
          cv.style.width = W + "px"; cv.style.height = H + "px";
          ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
          seed();
          if (reduceMotion) drawStatic();
        }

        function radius() {
          return Math.max(150, Math.min(300, Math.min(W, H) * 0.34));
        }

        /** 节点→指针的相似度：距离的线性映射，落在 0.57–0.99 */
        function similarity(d) {
          return 0.99 - (d / radius()) * 0.42;
        }

        function drawStatic() {
          ctx.clearRect(0, 0, W, H);
          for (const nd of NODES) {
            ctx.beginPath();
            ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2);
            ctx.fillStyle = "oklch(62% 0.02 250 / 0.5)";
            ctx.fill();
          }
        }

        function step() {
          frame++;
          ctx.clearRect(0, 0, W, H);

          // 指针平滑跟随，避免抖动
          pointer.x += (pointer.tx - pointer.x) * 0.12;
          pointer.y += (pointer.ty - pointer.y) * 0.12;

          // 长时间不动就让它自己走一条李萨如轨迹 —— 没人操作时画面也是活的
          if (!pointer.active || performance.now() - pointer.lastMove > 2600) {
            const t = frame / 210;
            pointer.tx = W * (0.5 + 0.32 * Math.cos(t * 0.9));
            pointer.ty = H * (0.5 + 0.28 * Math.sin(t * 1.3));
          }

          const R = radius();
          const px = pointer.x, py = pointer.y;

          // 节点漂移（极慢），出界回绕
          for (const nd of NODES) {
            nd.x += nd.vx; nd.y += nd.vy;
            if (nd.x < -20) nd.x = W + 20; else if (nd.x > W + 20) nd.x = -20;
            if (nd.y < -20) nd.y = H + 20; else if (nd.y > H + 20) nd.y = -20;
          }

          // 环境连线：静态网，每 24 帧重算一次，避免每帧 O(n²)
          if (frame % 24 === 1) {
            ambientWeb = [];
            const lim = 132 * 132;
            for (let i = 0; i < NODES.length; i++) {
              for (let j = i + 1; j < NODES.length; j++) {
                const dx = NODES[i].x - NODES[j].x, dy = NODES[i].y - NODES[j].y;
                if (dx * dx + dy * dy < lim) ambientWeb.push([i, j]);
              }
            }
          }
          ctx.lineWidth = 1;
          ctx.strokeStyle = "oklch(70% 0.02 250 / 0.09)";
          ctx.beginPath();
          for (const [i, j] of ambientWeb) {
            ctx.moveTo(NODES[i].x, NODES[i].y);
            ctx.lineTo(NODES[j].x, NODES[j].y);
          }
          ctx.stroke();

          // 召回判定
          const lit = [];
          for (const nd of NODES) {
            const dx = nd.x - px, dy = nd.y - py;
            const d = Math.hypot(dx, dy);
            nd._d = d;
            if (d < R) lit.push(nd);
          }
          lit.sort((a, b) => a._d - b._d);

          // 召回连线：指针 → 被召回的节点
          ctx.lineWidth = 1;
          for (const nd of lit) {
            const w = 1 - nd._d / R;
            ctx.strokeStyle = `oklch(63% 0.135 195 / ${(0.06 + w * 0.3).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(nd.x, nd.y);
            ctx.stroke();
          }

          // 精排保留的前 5 条：加粗连线 + 光晕 + 序号
          const top = lit.slice(0, 5);
          ctx.lineWidth = 1.4;
          ctx.strokeStyle = "oklch(63% 0.135 195 / 0.62)";
          ctx.beginPath();
          for (const nd of top) { ctx.moveTo(px, py); ctx.lineTo(nd.x, nd.y); }
          ctx.stroke();

          // 节点
          for (const nd of NODES) {
            const inLit = nd._d < R;
            const pulse = 1 + Math.sin(frame / 60 + nd.ph) * 0.18;
            const rr = nd.r * (inLit ? 1.5 : 1) * pulse;
            ctx.beginPath();
            ctx.arc(nd.x, nd.y, rr, 0, Math.PI * 2);
            if (inLit) {
              const w = 1 - nd._d / R;
              ctx.fillStyle = `oklch(${66 + w * 14}% 0.12 195 / ${(0.5 + w * 0.5).toFixed(2)})`;
            } else {
              ctx.fillStyle = "oklch(62% 0.02 250 / 0.42)";
            }
            ctx.fill();
          }

          for (const nd of top) {
            ctx.beginPath();
            ctx.arc(nd.x, nd.y, 9, 0, Math.PI * 2);
            ctx.strokeStyle = "oklch(63% 0.135 195 / 0.5)";
            ctx.lineWidth = 1;
            ctx.stroke();
          }

          // 指针十字准星
          ctx.strokeStyle = "oklch(63% 0.135 195 / 0.55)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(px, py, R * 0.06, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(px - 11, py); ctx.lineTo(px - 4, py);
          ctx.moveTo(px + 4, py); ctx.lineTo(px + 11, py);
          ctx.moveTo(px, py - 11); ctx.lineTo(px, py - 4);
          ctx.moveTo(px, py + 4); ctx.lineTo(px, py + 11);
          ctx.stroke();

          // 检索脉冲
          for (let i = ripples.length - 1; i >= 0; i--) {
            const rp = ripples[i];
            rp.r += (R * 1.5 - rp.r) * 0.06;
            rp.a *= 0.955;
            if (rp.a < 0.01) { ripples.splice(i, 1); continue; }
            ctx.beginPath();
            ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
            ctx.strokeStyle = `oklch(63% 0.135 195 / ${rp.a.toFixed(3)})`;
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }

          // 每 4 帧同步一次读出面板，别让 DOM 成为瓶颈
          if (frame % 4 === 0) paintHud(lit, top);
        }

        /* ---------------- 读出面板 ---------------- */
        const hudRecall = document.getElementById("hud-recall");
        const hudTop = document.getElementById("hud-top");
        const hudList = document.getElementById("hud-list");
        let lastSig = "";

        function paintHud(lit, top) {
          hudRecall.textContent = lit.length;
          hudTop.textContent = top.length ? similarity(top[0]._d).toFixed(3) : "—";

          const sig = top.map((n) => n.topic + similarity(n._d).toFixed(3)).join("|");
          if (sig === lastSig) return; // 没变就不动 DOM
          lastSig = sig;

          hudList.innerHTML = top
            .map(
              (n, i) => `<div class="hrow on">
                <span class="rk">${String(i + 1).padStart(2, "0")}</span>
                <span class="tp">${n.topic}</span>
                <span class="sim">${similarity(n._d).toFixed(2)}</span>
              </div>`
            )
            .join("");
        }

        /* ---------------- 指针事件 ---------------- */
        function toLocal(e) {
          const r = cv.getBoundingClientRect();
          return { x: e.clientX - r.left, y: e.clientY - r.top };
        }
        hero.addEventListener("pointermove", (e) => {
          const p = toLocal(e);
          pointer.tx = p.x; pointer.ty = p.y;
          pointer.active = true;
          pointer.lastMove = performance.now();
        });
        hero.addEventListener("pointerleave", () => { pointer.active = false; });
        hero.addEventListener("pointerdown", (e) => {
          const p = toLocal(e);
          pointer.tx = p.x; pointer.ty = p.y;
          pointer.active = true;
          pointer.lastMove = performance.now();
          ripples.push({ x: p.x, y: p.y, r: 8, a: 0.55 });
          if (!running && !reduceMotion) start();
        });

        /* ---------------- 循环调度 ---------------- */
        function start() {
          if (running) return;
          running = true;
          const loop = () => { if (!running) return; step(); rafId = requestAnimationFrame(loop); };
          rafId = requestAnimationFrame(loop);
        }
        function stop() {
          running = false;
          if (rafId) cancelAnimationFrame(rafId);
          rafId = 0;
        }

        if (reduceMotion) {
          resize();
          paintHud([], []);
        } else {
          resize();
          start();
          // 首屏滚出视野或标签页隐藏时停掉，不做无谓渲染
          new IntersectionObserver(
            (es) => es.forEach((en) => (en.isIntersecting && !document.hidden ? start() : stop())),
            { threshold: 0 }
          ).observe(hero);
          document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
        }
        window.addEventListener("resize", () => { resize(); });
      })();

      /* ============================================================================
         二、顶栏配色：压在暗色首屏上 vs 滚过之后
         ========================================================================== */
      (function () {
        const top = document.getElementById("top");
        const hero = document.getElementById("hero");
        function sync() {
          const past = window.scrollY > hero.offsetHeight - 78;
          top.className = "top " + (past ? "on-light" : "on-dark");
        }
        sync();
        window.addEventListener("scroll", sync, { passive: true });
        window.addEventListener("resize", sync);
      })();

      /* ============================================================================
         三、滚动入场
         ========================================================================== */
      (function () {
        const items = document.querySelectorAll(".rv");
        if (!("IntersectionObserver" in window)) {
          items.forEach((el) => el.classList.add("in"));
          return;
        }
        const io = new IntersectionObserver(
          (entries) => {
            entries.forEach((en) => {
              if (!en.isIntersecting) return;
              en.target.classList.add("in");
              en.target.querySelectorAll("[data-w]").forEach((bar, i) => {
                setTimeout(() => (bar.style.width = bar.dataset.w + "%"), 90 + i * 90);
              });
              io.unobserve(en.target);
            });
          },
          { threshold: 0.22 }
        );
        items.forEach((el) => io.observe(el));

        // 仪表环与总数独立观察：它们在 .rv 内部，但需要自己的时序
        const card = document.querySelector(".score-card");
        if (card) {
          const io2 = new IntersectionObserver(
            (es) => {
              es.forEach((en) => {
                if (!en.isIntersecting) return;
                document.getElementById("gaugeArc").style.strokeDashoffset = String(402 * (1 - 3.4 / 5));
                countTo(document.getElementById("gaugeNum"), 3.4, 2, 900);
                io2.unobserve(en.target);
              });
            },
            { threshold: 0.4 }
          );
          io2.observe(card);
        }

        function countTo(el, target, digits, dur) {
          const t0 = performance.now();
          (function tick(now) {
            const p = Math.min(1, (now - t0) / dur);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = (target * eased).toFixed(digits);
            if (p < 1) requestAnimationFrame(tick);
          })(performance.now());
        }
      })();

      /* ============================================================================
         四、对照卡里的步骤时间线：滚进视野后逐行跑一遍
         ========================================================================== */
      (function () {
        const STEPS = [
          { k: "检索", t: "查询向量化 · BGE-M3", ms: 63 },
          { k: "检索", t: "混合召回 · 候选 20 条", ms: 41 },
          { k: "检索", t: "精排 · 保留 5 条", ms: 188 },
          { k: "模型", t: "四维评分 · 逐维给理由", ms: 4180 },
        ];
        const host = document.getElementById("trace");
        if (!host) return;

        host.innerHTML = STEPS.map(
          (s, i) => `<div class="smi">
            <span class="k ${s.k}">${s.k}</span>
            <span class="v">${s.t}</span>
            <span class="m wait" data-m="${i}">运行中…</span>
            <span class="trackline"><i data-b="${i}"></i></span>
          </div>`
        ).join("");

        let played = false;
        function play() {
          if (played) return;
          played = true;
          const total = STEPS.reduce((a, s) => a + s.ms, 0);
          STEPS.forEach((s, i) => {
            setTimeout(() => {
              const bar = host.querySelector(`[data-b="${i}"]`);
              bar.style.height = "3px";
              // 宽度按该步在总耗时中的真实占比，不是等分
              bar.style.width = Math.max(6, (s.ms / total) * 100) + "%";
              const m = host.querySelector(`[data-m="${i}"]`);
              m.textContent = s.ms + " ms";
              m.classList.remove("wait");
            }, 140 + i * 210);
          });
        }

        const io = new IntersectionObserver(
          (es) => es.forEach((en) => en.isIntersecting && play()),
          { threshold: 0.5 }
        );
        io.observe(host);
      })();

      /* ============================================================================
         五、数据飞轮：六环排成环，弧线指向当前环
         ========================================================================== */
      (function () {
        const WHEEL = [
          { ic: "▸", lb: "作答", title: "用户写下回答",
            body: "在刷题训练里对一道题作答。这一步同时产生两样东西：一次评分请求，和一条未来的训练样本 —— 这是整条飞轮的入口。",
            tag: "入口", fact: "作答文本、题目 id 与方向/难度/题型一起进入评分链路。" },
          { ic: "◈", lb: "四维评分", title: "按 rubric 逐维评分",
            body: "正确性 0.40 / 完整性 0.30 / 表达与结构 0.15 / 术语准确性 0.15，每一维都必须给出评分理由与改进建议。系统不允许返回裸分数。",
            tag: "评分", fact: "结构化输出由服务端约束解码保证合法，字段再由 schema 校验。" },
          { ic: "▤", lb: "落库", title: "一条记录，三条下游",
            body: "(题目, 作答, 四维评分) 落进作答表。同一份数据被三个地方取用：错题本排期、能力画像聚合、微调数据集 —— 不需要为任何一个另做一套采集。",
            tag: "存储", fact: "作答会挂到具体题目 id 上；缺 id 时宁可不记录，也不挂到错的题上。" },
          { ic: "★", lb: "错题排期", title: "SM-2 间隔重复",
            body: "quality 直接取四维加权总分四舍五入 —— 评分量表本身就是 0 到 5，天然对齐，不用另做映射。连续答对 2 次才毕业移出错题本。",
            tag: "复习", fact: "答对一次就移出的话，刚排的复习计划永远不会触发。" },
          { ic: "⌗", lb: "导出样本", title: "导出 SFT 数据集",
            body: "把作答记录导出为 LLaMA-Factory 的训练格式。导出用的 prompt 必须与线上逐字一致，否则训推不一致 —— 微调学到的是另一个任务的分布。",
            tag: "数据", fact: "导出时会打印总分分布；全挤在中档说明数据没区分度，微调学不出东西。" },
          { ic: "⇄", lb: "微调评分器", title: "让本地小模型学会这套 rubric",
            body: "用系统自己产出的评分记录做 LoRA 微调，让小模型按同一套 rubric 输出同样的结构化结果。评测口径：与人工标注的一致率（±1 分内算一致）+ 每维 MAE。",
            tag: "微调", fact: "评测固定读运行时的模型配置，避免拿过期配置去测另一个模型。" },
        ];

        const ring = document.getElementById("ring");
        const C = 190, R = 132, CIRC = 2 * Math.PI * R;
        let active = 0;

        // 节点按环均分，并把它们钉在圆周上
        WHEEL.forEach((w, i) => {
          const ang = (i / WHEEL.length) * Math.PI * 2 - Math.PI / 2;
          const x = C + Math.cos(ang) * R;
          const y = C + Math.sin(ang) * R;
          const b = document.createElement("button");
          b.className = "wnode";
          b.type = "button";
          b.dataset.i = String(i);
          b.style.left = (x / 380 * 100) + "%";
          b.style.top = (y / 380 * 100) + "%";
          b.innerHTML = `<span class="ic">${w.ic}</span><span class="lb">${w.lb}</span>`;
          ring.appendChild(b);
        });

        const nodes = [...ring.querySelectorAll(".wnode")];
        const hi = document.getElementById("ringHi");

        function paint() {
          nodes.forEach((b, i) => b.setAttribute("aria-pressed", String(i === active)));
          const w = WHEEL[active];
          document.getElementById("ringNum").textContent = String(active + 1).padStart(2, "0");
          document.getElementById("ringCap").textContent = w.tag;
          document.getElementById("w-title").textContent = w.title;
          document.getElementById("w-body").textContent = w.body;
          document.getElementById("w-fact").innerHTML = `<b>${w.tag}</b> · ${w.fact}`;

          // 高亮弧从节点 0 画到当前节点。SVG 的 rotate(-90) 已经由 viewBox 对齐，
          // 这里按「顺时针累积」算长度，转成 dasharray 就是一段可见的弧。
          const seg = CIRC / WHEEL.length;
          const len = active === 0 ? seg * 0.34 : seg * (active + 0.34);
          hi.setAttribute("stroke-dasharray", `${len} ${CIRC}`);
        }

        ring.addEventListener("click", (e) => {
          const b = e.target.closest(".wnode");
          if (!b) return;
          active = Number(b.dataset.i);
          paint();
        });

        paint();
      })();
  } finally {
    EventTarget.prototype.addEventListener = origAdd;
  }

  return () => ac.abort();
}
