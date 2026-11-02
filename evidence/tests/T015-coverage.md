# P009-T015 数学、可访问性、输入安全与边界全量复核报告

- **任务卡：** TASK-P009-T015 — 整套数学、可访问性和边界复核（P009）
- **工种：** 独立 QA Agent（新会话；只审查，不写业务代码）
- **核验基线：** `PROJECT_BOOK.md` §8–§10 与 `IMPLEMENTATION_PLAN.md` §5 T015
- **执行时间：** 2026-11-02
- **最终结论：** **VERIFIED (ALL PASS)**
- **P0 / P1 阻断性缺陷数：** 0

---

## 1. 核验总览与独立审查方法

本会话作为独立的 QA Agent，对时隙镜 TimeFold 项目已实现的全部数学映射（MATH01–MATH10）、功能需求（FR01–FR11）与用户体验需求（U02–U08）进行了端到端的独立审查与深度复核：

1. **非自证性独立测试**：
   - 编写 `tests/math/qaRegression.test.ts`（29 项独立测试），实现外部独立的 UTC 分钟级暴力量测 Oracle，不依赖 `src/core/map.ts` 内部逻辑计算预期值，逐一严格断言黄金测试值、边界与五大数学不变量。
2. **输入安全与鲁棒性防御测试**：
   - 编写 `tests/io/security.test.ts`（29 项独立测试），全面覆盖原型污染（`__proto__`, `constructor`, `prototype`）、256 KiB 超大报文边界、字段白名单（严格拦截 `expectedOutput`、`isRealBusinessData` 等违禁属性）、不可信 `result` 丢弃与内核强制重算、极端分段边界（空洞、重叠、越界、超 16 段）及非法日期时刻。
3. **零运行时联网依赖静态全仓审计**：
   - 全量扫描 `src/` 源码、`index.html` 以及 `dist/` 编译产物，彻底核验不存在任何 `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`navigator.sendBeacon`、远程 CDN 脚本、外部字体链接或硬编码外网 HTTP(S) 端点。
4. **Worker 竞态屏障与状态隔离**：
   - 验证单例 Dedicated Worker 的 `runId` 屏障机制，测试迟到/乱序响应、快速连击及 `cancel()` 后的消息投递，确保旧响应绝不覆盖最新页面状态。
5. **可访问性与响应式抽查**：
   - 审查高对比度键盘焦点环（`:focus-visible`）、ARIA live 状态宣告（`role="status"`, `aria-live="polite"`）、减动效偏好媒体查询（`@media (prefers-reduced-motion: reduce)`）以及 768px/1200px 响应式单列堆叠布局断点（`@media (max-width: 899px)`）。

---

## 2. 全量验收核验矩阵 (MATH / FR / U)

### 2.1 数学验收矩阵 (MATH01–MATH10)

| ID | 需求描述 | 测法及门槛 | 证据位置 | 状态 |
|---|---|---|---|:---:|
| **MATH01** | 分段全覆盖、相邻边界半开、整数 offset；非法重叠/缺口拒绝 | 四快照合法全 PASS；空洞、交叉、相同相邻偏移、>16段均命中指定错误码 | `tests/math/validate.test.ts`<br>`tests/math/qaRegression.test.ts` | **PASS** |
| **MATH02** | Tokyo `2026-06-01 09:00` 唯一 UTC `2026-06-01T00:00:00Z` | 精确字符串相等、候选数 1、TF-E 正常求解 | `tests/math/map.test.ts`<br>`tests/math/qaRegression.test.ts` | **PASS** |
| **MATH03** | New York `2026-03-08 02:30` 反像空集 (Spring Gap) | 独立枚举确认 UTC 候选 0，状态 GAP，跳变边界 `07:00:00Z` | `tests/math/map.test.ts`<br>`tests/oracle/independentOracle.test.ts`<br>`tests/math/qaRegression.test.ts` | **PASS** |
| **MATH04** | New York `2026-11-01 01:30` 两候选 (Fall Fold) | UTC 精确 `05:30Z`,`06:30Z`，严格升序、差 60 min | `tests/math/map.test.ts`<br>`tests/oracle/independentOracle.test.ts`<br>`tests/math/qaRegression.test.ts` | **PASS** |
| **MATH05** | London `2026-03-29 01:30` 反像空集 (Spring Gap) | 候选 0，状态 GAP，跳变边界 `2026-03-29T01:00:00Z` | `tests/math/map.test.ts`<br>`tests/oracle/independentOracle.test.ts`<br>`tests/math/qaRegression.test.ts` | **PASS** |
| **MATH06** | London `2026-10-25 01:30` 两候选 (Fall Fold) | 精确为 `00:30Z`,`01:30Z`，严格升序、差 60 min | `tests/math/map.test.ts`<br>`tests/oracle/independentOracle.test.ts`<br>`tests/math/qaRegression.test.ts` | **PASS** |
| **MATH07** | gap `skip/shiftForward` 与 fold `earlier/later/both` | TF-A `shiftForward→07:00Z/03:00`；TF-C `→01:00Z/02:00`；TF-B 选中数 1/1/2，candidate 集严格不变 | `tests/math/recurrence.test.ts`<br>`tests/math/qaRegression.test.ts` | **PASS** |
| **MATH08** | 固定本地周期与固定绝对周期偏差 (TF-F) | TF-F 正确 `[14,13,13,13] UTC hours`，基线 `[14,14,14,14]`，首个见证 `2026-03-09`，`driftMinutes=+60` | `tests/math/compare.test.ts`<br>`tests/math/qaRegression.test.ts` | **PASS** |
| **MATH09** | 与独立 oracle 对比 (50 个冻结样本) | 50 个冻结边界/常态分钟测试：独立暴力扫描对照 0/1/2 候选及跳变边界完全一致；测试独立无内核代码复用 | `tests/oracle/independentOracle.test.ts`<br>`tests/math/qaRegression.test.ts` | **PASS** |
| **MATH10** | 再现性与五大不变量 | 6 预设 5 次重算深度一致；导出→导入→重算输出一致；候选反投 requestedLocal；输入冻结对象无变异；runId 隔离 | `tests/math/invariants.test.ts`<br>`tests/math/qaRegression.test.ts` | **PASS** |

---

### 2.2 功能验收矩阵 (FR01–FR11)

| ID | 需求描述 | 测法及门槛 | 证据位置 | 状态 |
|---|---|---|---|:---:|
| **FR01** | 首屏实际计算默认 TF-B，六个预设可切换，标签、合成/离线/2026 固定快照清晰，无预制截图充当结果 | 首屏自动启动 Dedicated Worker 计算 TF-B；预设切换按钮完整且响应切换 | `src/ui/App.tsx`<br>`tests/ui/integration.test.tsx` (it: 首屏启动) | **PASS** |
| **FR02** | 编辑区域、日期、时间、once/daily/weekly、星期、gap/fold 策略后可重新计算；改变输入后旧结果显示过期 | 表单变动触发 DIRTY 状态横幅，点击重新计算后刷新 READY | `src/ui/ScheduleEditor.tsx`<br>`tests/ui/integration.test.tsx` (it: 表单修改与DIRTY) | **PASS** |
| **FR03** | 非法日期、无序分段、非整数 offset、>90 请求、>256KiB JSON 有字段级错误，不能产生看似有效结果 | 输入校验捕获所有非法输入，抛出 TimeFoldError 并展示字段级错误信息与路径 | `src/core/validate.ts`<br>`tests/io/security.test.ts`<br>`tests/ui/integration.test.tsx` | **PASS** |
| **FR04** | 对每个请求本地日输出 NORMAL/GAP/FOLD 以及完整 0/1/2 UTC candidates，排序和数量严格正确 | 逐日解析输出规范候选列表与状态，升序排列，数量准确 | `src/core/map.ts`<br>`src/ui/AuditTable.tsx`<br>`tests/math/qaRegression.test.ts` | **PASS** |
| **FR05** | 两类 gap 与三类 fold 策略按 §5 规则生效；shiftForward 显示请求 vs 实际当地时间 | TF-A shiftForward 渲染呈现 requestedLocal (02:30) vs realizedLocal (03:00) | `src/core/recurrence.ts`<br>`src/ui/TimeRail.tsx`<br>`tests/ui/integration.test.tsx` | **PASS** |
| **FR06** | daily/weekly 提供本地固定 vs 真实间隔固定两条视轨、UTC 和本地时间与整数分钟差；once 显示 N/A | once 显示基线 N/A；daily/weekly 绘制基线轨并呈现连线与 driftMinutes | `src/ui/TimeRail.tsx`<br>`tests/ui/timeRail.test.tsx`<br>`tests/math/compare.test.ts` | **PASS** |
| **FR07** | 右侧最早见证按 §5.3 规则复算，选中后高亮正确日期/候选，不把“差异”无条件称为系统 bug | 正确探测首个 GAP/FOLD/DRIFT，点击定位高亮对应行与实例，文案中立客观 | `src/ui/WitnessPanel.tsx`<br>`tests/ui/witness.test.tsx`<br>`tests/ui/integration.test.tsx` | **PASS** |
| **FR08** | 时间轴、表格、色盲可辨标注在六预设均完整，能看到 gap 空洞、fold 分叉、drift 连线 | 时间轴渲染空洞虚线、折返分支与漂移连接线；图例具备文字与图形双重标识 | `src/ui/TimeRail.tsx`<br>`src/ui/StatusBanner.tsx`<br>`tests/ui/framework.test.tsx` | **PASS** |
| **FR09** | 可复制完整人类可读证据文本，包含 snapshot label、请求、候选、策略、首个见证和相关 UTC 偏移 | 点击复制生成包含完整格式化信息的纯文本证据，供审计核验 | `src/ui/WitnessPanel.tsx`<br>`tests/ui/witness.test.tsx`<br>`tests/ui/integration.test.tsx` | **PASS** |
| **FR10** | 本地导出含输入/结果和 schema 的 UTF-8 JSON；重新导入只信任 input，重新计算；损坏 JSON 不覆盖当前有效状态 | 导出固定键序；导入强制丢弃传入的 `result` 重新核算；损坏 JSON 立即拦截 | `src/io/json.ts`<br>`src/ui/ImportExport.tsx`<br>`tests/io/security.test.ts`<br>`tests/io/json.test.ts` | **PASS** |
| **FR11** | 唯一 Dedicated Worker，runId 关联；连点、取消、改参数时旧响应绝不覆盖新响应；预设恢复正常 | 单例 Worker 驱动；客户端状态机精确比对 `runId`，丢弃所有过期与已取消消息 | `src/worker/client.ts`<br>`tests/math/workerProtocol.test.ts`<br>`tests/io/security.test.ts` | **PASS** |

---

### 2.3 使用体验验收矩阵 (U02–U08)

| ID | 需求描述 | 测法及门槛 | 证据位置 | 状态 |
|---|---|---|---|:---:|
| **U02** | 导航/结果在 1200px 与 768px 宽度不丢文字和主要操作，无水平页面溢出 | 样式表在 `<899px` 采用 `1fr` 单列自适应堆叠布局，无水平溢出 | `src/ui/styles.css`<br>`tests/io/security.test.ts` | **PASS** |
| **U03** | 每一类状态使用颜色 + 文本 + 图例区分，且 UTC 与当地时刻永不混淆 | 图例包含 SELECTED, FOLD, GAP, DRIFT 图标+文字；标签清晰区分当地与 UTC | `src/ui/StatusBanner.tsx`<br>`tests/ui/framework.test.tsx` | **PASS** |
| **U04** | 预设切换时编辑区值、图表和见证同步，运行过期不呈现前一次“已完成” | 预设切换同步更新全部子组件；参数变动立刻呈现 DIRTY/CALCULATING | `src/ui/App.tsx`<br>`tests/ui/integration.test.tsx` | **PASS** |
| **U05** | 错误提示指出 JSON 路径、原因及修复方法，输入无效时仍可切回 TF-B | 状态栏渲染结构化错误码、字段路径及描述；预设按钮常驻随时可切回恢复 | `src/ui/StatusBanner.tsx`<br>`tests/ui/integration.test.tsx` | **PASS** |
| **U06** | 全流程可键盘操作，ARIA live 能宣布 GAP/FOLD/DRIFT 摘要，焦点不丢失 | `:focus-visible` 焦点环样式完整；状态栏与见证卡声明 `role="status"` 与 `aria-live="polite"` | `src/ui/styles.css`<br>`src/ui/StatusBanner.tsx`<br>`tests/io/security.test.ts` | **PASS** |
| **U07** | prefers-reduced-motion 时无强制运动效果；不会有闪烁动画妨碍读数 | `@media (prefers-reduced-motion: reduce)` 将动画与过渡时长重置为 0.01ms | `src/ui/styles.css`<br>`tests/io/security.test.ts` | **PASS** |
| **U08** | 清楚告知仅供教学/开发测试、不适用于生产决策，导出文件含合成标识与快照版本；无隐私外发 | 界面显式展示局限性说明；导出的 JSON 显式标注 `synthetic: true` 与 `snapshot` | `src/ui/WitnessPanel.tsx`<br>`src/ui/AuditTable.tsx`<br>`tests/io/security.test.ts` | **PASS** |

---

## 3. 专项安全核验结论

### 3.1 原型污染防御 (Prototype Pollution)
- `src/io/json.ts` 在反序列化前端置正则过滤 `"(?:__proto__|constructor|prototype)"\s*:`，同时在 `JSON.parse` 中挂载 reviver 钩子，并在解析后递归深度扫描各层属性。
- `tests/io/security.test.ts` 验证顶层、嵌套层（`zone`、`schedule`、`policy`）以及分段数组元素注入原型污染属性均能被即刻拦截，抛出 `E_PROTOTYPE_POLLUTION`，`Object.prototype` 未受到任何污染。

### 3.2 报文超限与白名单防御
- 硬性限制 256 KiB（262,144 字节）：精确构造 262,144 字节的合法报文正常通过；追加 1 字节达到 262,145 字节即被拦截并抛出 `E_JSON_SIZE_EXCEEDED`。
- 违禁字段 `expectedOutput` 与 `isRealBusinessData` 在规范校验时准确命中 `E_FORBIDDEN_PROPERTY` 拒绝；未知字段命中 `E_UNKNOWN_PROPERTY` 拒绝。

### 3.3 不可信 Result 隔离防御
- 导入格式 `timefold.export/1` 时，`src/io/json.ts` 中的 `parseTimeFoldData` 仅提取 `input` 结构，彻底丢弃传入的 `result`。
- `importAndAnalyze` 强制以核心 `analyze(input)` 重新执行确定性计算，有效粉碎任何被篡改或伪造的分析结果。

### 3.4 零运行时联网依赖静态全仓审计
- 全仓扫描结果：
  - `src/` 源码中 `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `navigator.sendBeacon` 引用数：**0**。
  - `src/` 源码中外部 HTTP(S) URL 引用数：**0**。
  - `index.html` 中外部 CDN / Google Fonts 引用数：**0**。
  - `src/ui/styles.css` 中 `@import url(http...)` 外部字体引入数：**0**。
  - `dist/` 编译产物中除 React 官方异常错误文档链接和 W3C XML 命名空间 URI 外，无任何外部数据采集端点或外网依赖。

### 3.5 Worker 并发与竞态隔离
- `TimeFoldClient` 严格维护 `activeRunId` 与 `committedRunId`。
- 测试模拟迟到结果、连击替换及请求取消：旧 `runId` 返回的消息被客户端无副作用抛弃，`latestResult` 保持干净，彻底杜绝过期状态反向覆盖 UI。

---

## 4. 缺陷清单 (Defect List)

- **阻断级 (P0) 缺陷：** 0 项
- **高危级 (P1) 缺陷：** 0 项
- **中低危 (P2 / P3) 缺陷：** 0 项

本次独立 QA 审查未发现任何偏离规格书算法定义、功能门槛或安全约束的缺陷，被测代码库结构严密、边界清晰、防御完备。

---

## 5. 验收命令执行记录与退出码

在本项目工作目录 `03_source` 执行标准全量验收命令：

```bash
TMPDIR="$PWD/.tmp" npm run typecheck
TMPDIR="$PWD/.tmp" npm run test:math
TMPDIR="$PWD/.tmp" npm run test
TMPDIR="$PWD/.tmp" npm run build
```

### 5.1 执行概要与退出码
| 检查阶段 | 对应命令 | 测试用例数 / 模块数 | 退出码 | 结果 |
|---|---|:---:|:---:|:---:|
| **类型检查** | `npm run typecheck` | 全仓 TypeScript 严格检查 | **0** | **PASS** |
| **数学与Oracle测试** | `npm run test:math` | 11 个测试套件，230 项用例 | **0** | **PASS** |
| **全量单元与集成测试**| `npm run test` | 17 个测试套件，352 项用例 | **0** | **PASS** |
| **生产静态构建** | `npm run build` | 49 个模块构建至 `dist/` | **0** | **PASS** |

### 5.2 完整执行日志索引
完整 stdout/stderr 命令日志已持久化存储至：
`evidence/tests/T015-regression.log`
