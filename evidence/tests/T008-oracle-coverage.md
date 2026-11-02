# P009-T008 独立数学 Oracle 与不变量测试覆盖报告

- **任务卡：** TASK-P009-T008 — 独立数学 oracle 与不变量测试（P009）
- **工种角色：** 独立验证 Agent（全新会话；独立于核心作者，保障验证完全客观）
- **验证基准：** `PROJECT_BOOK.md` §5–§8（尤其 MATH09–MATH10）与 `IMPLEMENTATION_PLAN.md` §5 T008
- **工作目录：** `03_source`
- **执行时间：** 2026-11-02T04:37:30Z
- **被测黑盒：** T007 已合并内核代码（严禁并切实未修改 `src/core/`、`src/data/`、`src/ui/`、锁文件、正式黄金答案、规格文件）

---

## 1. 独立 Oracle 构造方法与原理

### 1.1 独立性契约
独立 Oracle 代码位于 [`tests/oracle/independentOracle.test.ts`](file:///home/hatch/workspace/p009-work/P009-timefold/03_source/tests/oracle/independentOracle.test.ts)。
- **绝不调用或引用生产映射**：Oracle 严禁使用 `mapLocal`、`findCandidateUtcMinutes`、`projectUtc` 或任何 `src/core/map.ts` 导出作为真值。
- **纯定义暴力穷举**：基于夏令时公历跳折数学严格定义，采用 UTC 整数分钟全空间暴力扫描算法。
- **零依赖原则**：不安装或引入 `@js-temporal/polyfill`，不修改 `package-lock.json`，依托标准 ECMAScript `Date.UTC` 与纯公历整数分钟算术构建独立时钟解析与投影。

### 1.2 暴力穷举算法规格
对于任意请求的当地墙上公历分钟 $L^* \in \mathbb{Z}$（自 1970-01-01 纪元起的公历民用分钟）：
1. **分段边界加载**：解析指定冻结时区的每个半开区间分段 $S_i = [A_i, B_i)$ 及其偏移 $O_i$（以分钟计）。
2. **搜索窗口界定**：令 $O_{\min} = \min_i(O_i)$，$O_{\max} = \max_i(O_i)$。任何可能映射至 $L^*$ 的 UTC 候选时刻 $t$ 必然位于 $t + O_i = L^*$ 的解集中，因此暴力扫描区间严格界定为 $[L^* - O_{\max} - 1440, L^* - O_{\min} + 1440]$（整整放宽 24 小时容差）。
3. **逐分钟前向校验**：遍历该区间内的每一个整数 UTC 分钟 $t$：
   - 寻找包含 $t$ 的唯一分段 $S_i$（即满足 $A_i \le t < B_i$）；
   - 计算前向当地时间 $L(t) = t + O_i$；
   - 若 $L(t) === L^*$，则将 $t$ 记录为有效 UTC 候选。
4. **反像判定与状态归类**：
   - 候选数 $= 1$：判定为 `NORMAL`（常态映射）；
   - 候选数 $= 2$：判定为 `FOLD`（回拨重叠）；
   - 候选数 $= 0$：判定为 `GAP`（跳跃空洞），进一步根据跳跃边界 $u$（$O_{i+1} > O_i$ 处）在当地时间缺失区间 $[u + O_i, u + O_{i+1})$ 识别 `gapBoundaryUtc = u`；
   - 候选数 $> 2$：抛出 `E_AMBIGUITY_GT2`。

---

## 2. 六个确定性预设全量对照验证 (TF-A 至 TF-F)

独立 Oracle 与被测内核在六预设全部策略组合下进行全量比对，结果 100% 一致：

| 预设 ID | 预设名称 | 区域与请求时间 | 策略组合 | 独立 Oracle 期望 | 内核实际计算输出 | 一致性 | 见证裁决 |
|---|---|---|---|---|---|---|---|
| **TF-A** | 春季缺口 | America/New_York<br>`2026-03-08 02:30` | `gap: skip`<br>`fold: earlier` | `status: GAP`<br>候选: 0, 选中: 0<br>gapBoundary: `07:00Z` | `status: GAP`<br>candidatesUtc: `[]`<br>selectedUtc: `[]` | ✅ 零容差完全一致 | `GAP`<br>boundary: `2026-03-08T07:00:00Z` |
| **TF-A** | 春季缺口 (顺延) | America/New_York<br>`2026-03-08 02:30` | `gap: shiftForward`<br>`fold: earlier` | `status: GAP`<br>候选: 0, 选中: 1<br>selectedUtc: `07:00Z`<br>realizedLocal: `03:00` | `status: GAP`<br>candidatesUtc: `[]`<br>selectedUtc: `["2026-03-08T07:00:00Z"]`<br>realizedLocal: `["2026-03-08 03:00"]` | ✅ 零容差完全一致 | `GAP`<br>boundary: `2026-03-08T07:00:00Z` |
| **TF-B** | 双生一刻 | America/New_York<br>`2026-11-01 01:30` | `gap: skip`<br>`fold: both` | `status: FOLD`<br>候选: `05:30Z`, `06:30Z`<br>选中: 2 (差 60 min) | `status: FOLD`<br>candidatesUtc: `["05:30Z", "06:30Z"]`<br>selectedUtc: `["05:30Z", "06:30Z"]` | ✅ 零容差完全一致 | `FOLD`<br>date: `2026-11-01` |
| **TF-B** | 双生一刻 (前折) | America/New_York<br>`2026-11-01 01:30` | `gap: skip`<br>`fold: earlier` | `status: FOLD`<br>候选: 2, 选中: 1 (`05:30Z`) | `status: FOLD`<br>candidatesUtc: 2<br>selectedUtc: `["2026-11-01T05:30:00Z"]` | ✅ 零容差完全一致 | `FOLD`<br>date: `2026-11-01` |
| **TF-B** | 双生一刻 (后折) | America/New_York<br>`2026-11-01 01:30` | `gap: skip`<br>`fold: later` | `status: FOLD`<br>候选: 2, 选中: 1 (`06:30Z`) | `status: FOLD`<br>candidatesUtc: 2<br>selectedUtc: `["2026-11-01T06:30:00Z"]` | ✅ 零容差完全一致 | `FOLD`<br>date: `2026-11-01` |
| **TF-C** | 伦敦缺口 | Europe/London<br>`2026-03-29 01:30` | `gap: skip`<br>`fold: earlier` | `status: GAP`<br>候选: 0, 选中: 0<br>gapBoundary: `01:00Z` | `status: GAP`<br>candidatesUtc: `[]`<br>selectedUtc: `[]` | ✅ 零容差完全一致 | `GAP`<br>boundary: `2026-03-29T01:00:00Z` |
| **TF-C** | 伦敦缺口 (顺延) | Europe/London<br>`2026-03-29 01:30` | `gap: shiftForward`<br>`fold: earlier` | `status: GAP`<br>候选: 0, 选中: 1 (`01:00Z`)<br>realizedLocal: `02:00` | `status: GAP`<br>selectedUtc: `["2026-03-29T01:00:00Z"]`<br>realizedLocal: `["2026-03-29 02:00"]` | ✅ 零容差完全一致 | `GAP`<br>boundary: `2026-03-29T01:00:00Z` |
| **TF-D** | 伦敦重叠 | Europe/London<br>`2026-10-25 01:30` | `gap: skip`<br>`fold: both` | `status: FOLD`<br>候选: `00:30Z`, `01:30Z`<br>选中: 2 (差 60 min) | `status: FOLD`<br>candidatesUtc: `["00:30Z", "01:30Z"]`<br>selectedUtc: `["00:30Z", "01:30Z"]` | ✅ 零容差完全一致 | `FOLD`<br>date: `2026-10-25` |
| **TF-E** | 东京常态 | Asia/Tokyo<br>`2026-06-01..03 09:00` | `gap: skip`<br>`fold: earlier` | 每日均为 `NORMAL`<br>UTC 均为 `00:00Z`<br>漂移均为 0 min | 每日均为 `NORMAL`<br>UTC 均为 `00:00Z`<br>driftMinutes 均为 0 | ✅ 零容差完全一致 | `NONE`<br>(首个见证无异常) |
| **TF-F** | 固定间隔漂移 | America/New_York<br>4 个周一 `09:00` | `gap: skip`<br>`fold: earlier` | 3/2: `14:00Z` (drift=0)<br>3/9: `13:00Z` (drift=+60)<br>3/16: `13:00Z` (drift=+60)<br>3/23: `13:00Z` (drift=+60) | 3/2: `14:00Z` (drift=0)<br>3/9: `13:00Z` (drift=60)<br>3/16: `13:00Z` (drift=60)<br>3/23: `13:00Z` (drift=60) | ✅ 零容差完全一致 | `DRIFT`<br>date: `2026-03-09`<br>drift: +60 min |

---

## 3. 50 个冻结边界/合法范围分钟样本逐一比对 (SMP-01 至 SMP-50)

全部 50 个测试样本均由独立 Oracle 暴力扫描计算预期真值，并逐一与内核 `mapLocal` 对比：

| 样本 ID | 类别 | 时区快照 | 请求当地时间 | 独立 Oracle 状态 | 独立 Oracle 候选 | 内核状态 | 内核候选 | 比对结果 |
|---|---|---|---|---|---|---|---|---|
| **SMP-01** | NY Spring Gap Boundary | `America/New_York` | `2026-03-08 01:59` | `NORMAL` | `2026-03-08T06:59:00Z` | `NORMAL` | `2026-03-08T06:59:00Z` | ✅ MATCH |
| **SMP-02** | NY Spring Gap Boundary | `America/New_York` | `2026-03-08 02:00` | `GAP` | None (跃迁: `2026-03-08T07:00:00Z`) | `GAP` | None (跃迁: `2026-03-08T07:00:00Z`) | ✅ MATCH |
| **SMP-03** | NY Spring Gap Boundary | `America/New_York` | `2026-03-08 02:01` | `GAP` | None (跃迁: `2026-03-08T07:00:00Z`) | `GAP` | None (跃迁: `2026-03-08T07:00:00Z`) | ✅ MATCH |
| **SMP-04** | NY Spring Gap Boundary | `America/New_York` | `2026-03-08 02:30` | `GAP` | None (跃迁: `2026-03-08T07:00:00Z`) | `GAP` | None (跃迁: `2026-03-08T07:00:00Z`) | ✅ MATCH |
| **SMP-05** | NY Spring Gap Boundary | `America/New_York` | `2026-03-08 02:59` | `GAP` | None (跃迁: `2026-03-08T07:00:00Z`) | `GAP` | None (跃迁: `2026-03-08T07:00:00Z`) | ✅ MATCH |
| **SMP-06** | NY Spring Gap Boundary | `America/New_York` | `2026-03-08 03:00` | `NORMAL` | `2026-03-08T07:00:00Z` | `NORMAL` | `2026-03-08T07:00:00Z` | ✅ MATCH |
| **SMP-07** | NY Spring Gap Boundary | `America/New_York` | `2026-03-08 03:01` | `NORMAL` | `2026-03-08T07:01:00Z` | `NORMAL` | `2026-03-08T07:01:00Z` | ✅ MATCH |
| **SMP-08** | NY Fall Fold Boundary | `America/New_York` | `2026-11-01 00:59` | `NORMAL` | `2026-11-01T04:59:00Z` | `NORMAL` | `2026-11-01T04:59:00Z` | ✅ MATCH |
| **SMP-09** | NY Fall Fold Boundary | `America/New_York` | `2026-11-01 01:00` | `FOLD` | `2026-11-01T05:00:00Z, 2026-11-01T06:00:00Z` | `FOLD` | `2026-11-01T05:00:00Z, 2026-11-01T06:00:00Z` | ✅ MATCH |
| **SMP-10** | NY Fall Fold Boundary | `America/New_York` | `2026-11-01 01:01` | `FOLD` | `2026-11-01T05:01:00Z, 2026-11-01T06:01:00Z` | `FOLD` | `2026-11-01T05:01:00Z, 2026-11-01T06:01:00Z` | ✅ MATCH |
| **SMP-11** | NY Fall Fold Boundary | `America/New_York` | `2026-11-01 01:30` | `FOLD` | `2026-11-01T05:30:00Z, 2026-11-01T06:30:00Z` | `FOLD` | `2026-11-01T05:30:00Z, 2026-11-01T06:30:00Z` | ✅ MATCH |
| **SMP-12** | NY Fall Fold Boundary | `America/New_York` | `2026-11-01 01:59` | `FOLD` | `2026-11-01T05:59:00Z, 2026-11-01T06:59:00Z` | `FOLD` | `2026-11-01T05:59:00Z, 2026-11-01T06:59:00Z` | ✅ MATCH |
| **SMP-13** | NY Fall Fold Boundary | `America/New_York` | `2026-11-01 02:00` | `NORMAL` | `2026-11-01T07:00:00Z` | `NORMAL` | `2026-11-01T07:00:00Z` | ✅ MATCH |
| **SMP-14** | NY Fall Fold Boundary | `America/New_York` | `2026-11-01 02:01` | `NORMAL` | `2026-11-01T07:01:00Z` | `NORMAL` | `2026-11-01T07:01:00Z` | ✅ MATCH |
| **SMP-15** | London Spring Gap Boundary | `Europe/London` | `2026-03-29 00:59` | `NORMAL` | `2026-03-29T00:59:00Z` | `NORMAL` | `2026-03-29T00:59:00Z` | ✅ MATCH |
| **SMP-16** | London Spring Gap Boundary | `Europe/London` | `2026-03-29 01:00` | `GAP` | None (跃迁: `2026-03-29T01:00:00Z`) | `GAP` | None (跃迁: `2026-03-29T01:00:00Z`) | ✅ MATCH |
| **SMP-17** | London Spring Gap Boundary | `Europe/London` | `2026-03-29 01:01` | `GAP` | None (跃迁: `2026-03-29T01:00:00Z`) | `GAP` | None (跃迁: `2026-03-29T01:00:00Z`) | ✅ MATCH |
| **SMP-18** | London Spring Gap Boundary | `Europe/London` | `2026-03-29 01:30` | `GAP` | None (跃迁: `2026-03-29T01:00:00Z`) | `GAP` | None (跃迁: `2026-03-29T01:00:00Z`) | ✅ MATCH |
| **SMP-19** | London Spring Gap Boundary | `Europe/London` | `2026-03-29 01:59` | `GAP` | None (跃迁: `2026-03-29T01:00:00Z`) | `GAP` | None (跃迁: `2026-03-29T01:00:00Z`) | ✅ MATCH |
| **SMP-20** | London Spring Gap Boundary | `Europe/London` | `2026-03-29 02:00` | `NORMAL` | `2026-03-29T01:00:00Z` | `NORMAL` | `2026-03-29T01:00:00Z` | ✅ MATCH |
| **SMP-21** | London Spring Gap Boundary | `Europe/London` | `2026-03-29 02:01` | `NORMAL` | `2026-03-29T01:01:00Z` | `NORMAL` | `2026-03-29T01:01:00Z` | ✅ MATCH |
| **SMP-22** | London Fall Fold Boundary | `Europe/London` | `2026-10-25 00:59` | `NORMAL` | `2026-10-24T23:59:00Z` | `NORMAL` | `2026-10-24T23:59:00Z` | ✅ MATCH |
| **SMP-23** | London Fall Fold Boundary | `Europe/London` | `2026-10-25 01:00` | `FOLD` | `2026-10-25T00:00:00Z, 2026-10-25T01:00:00Z` | `FOLD` | `2026-10-25T00:00:00Z, 2026-10-25T01:00:00Z` | ✅ MATCH |
| **SMP-24** | London Fall Fold Boundary | `Europe/London` | `2026-10-25 01:01` | `FOLD` | `2026-10-25T00:01:00Z, 2026-10-25T01:01:00Z` | `FOLD` | `2026-10-25T00:01:00Z, 2026-10-25T01:01:00Z` | ✅ MATCH |
| **SMP-25** | London Fall Fold Boundary | `Europe/London` | `2026-10-25 01:30` | `FOLD` | `2026-10-25T00:30:00Z, 2026-10-25T01:30:00Z` | `FOLD` | `2026-10-25T00:30:00Z, 2026-10-25T01:30:00Z` | ✅ MATCH |
| **SMP-26** | London Fall Fold Boundary | `Europe/London` | `2026-10-25 01:59` | `FOLD` | `2026-10-25T00:59:00Z, 2026-10-25T01:59:00Z` | `FOLD` | `2026-10-25T00:59:00Z, 2026-10-25T01:59:00Z` | ✅ MATCH |
| **SMP-27** | London Fall Fold Boundary | `Europe/London` | `2026-10-25 02:00` | `NORMAL` | `2026-10-25T02:00:00Z` | `NORMAL` | `2026-10-25T02:00:00Z` | ✅ MATCH |
| **SMP-28** | London Fall Fold Boundary | `Europe/London` | `2026-10-25 02:01` | `NORMAL` | `2026-10-25T02:01:00Z` | `NORMAL` | `2026-10-25T02:01:00Z` | ✅ MATCH |
| **SMP-29** | NY Normal & Cross-Month | `America/New_York` | `2026-01-15 12:00` | `NORMAL` | `2026-01-15T17:00:00Z` | `NORMAL` | `2026-01-15T17:00:00Z` | ✅ MATCH |
| **SMP-30** | NY Normal & Cross-Month | `America/New_York` | `2026-02-28 23:59` | `NORMAL` | `2026-03-01T04:59:00Z` | `NORMAL` | `2026-03-01T04:59:00Z` | ✅ MATCH |
| **SMP-31** | NY Normal & Cross-Month | `America/New_York` | `2026-03-01 00:00` | `NORMAL` | `2026-03-01T05:00:00Z` | `NORMAL` | `2026-03-01T05:00:00Z` | ✅ MATCH |
| **SMP-32** | NY Normal & Cross-Month | `America/New_York` | `2026-06-15 12:00` | `NORMAL` | `2026-06-15T16:00:00Z` | `NORMAL` | `2026-06-15T16:00:00Z` | ✅ MATCH |
| **SMP-33** | NY Normal & Cross-Month | `America/New_York` | `2026-10-31 23:59` | `NORMAL` | `2026-11-01T03:59:00Z` | `NORMAL` | `2026-11-01T03:59:00Z` | ✅ MATCH |
| **SMP-34** | NY Normal & Cross-Month | `America/New_York` | `2026-12-31 23:59` | `NORMAL` | `2027-01-01T04:59:00Z` | `NORMAL` | `2027-01-01T04:59:00Z` | ✅ MATCH |
| **SMP-35** | London Normal & Cross-Month | `Europe/London` | `2026-01-15 12:00` | `NORMAL` | `2026-01-15T12:00:00Z` | `NORMAL` | `2026-01-15T12:00:00Z` | ✅ MATCH |
| **SMP-36** | London Normal & Cross-Month | `Europe/London` | `2026-02-28 23:59` | `NORMAL` | `2026-02-28T23:59:00Z` | `NORMAL` | `2026-02-28T23:59:00Z` | ✅ MATCH |
| **SMP-37** | London Normal & Cross-Month | `Europe/London` | `2026-03-01 00:00` | `NORMAL` | `2026-03-01T00:00:00Z` | `NORMAL` | `2026-03-01T00:00:00Z` | ✅ MATCH |
| **SMP-38** | London Normal & Cross-Month | `Europe/London` | `2026-07-15 12:00` | `NORMAL` | `2026-07-15T11:00:00Z` | `NORMAL` | `2026-07-15T11:00:00Z` | ✅ MATCH |
| **SMP-39** | London Normal & Cross-Month | `Europe/London` | `2026-08-31 23:59` | `NORMAL` | `2026-08-31T22:59:00Z` | `NORMAL` | `2026-08-31T22:59:00Z` | ✅ MATCH |
| **SMP-40** | London Normal & Cross-Month | `Europe/London` | `2026-09-01 00:00` | `NORMAL` | `2026-08-31T23:00:00Z` | `NORMAL` | `2026-08-31T23:00:00Z` | ✅ MATCH |
| **SMP-41** | Tokyo Normal & Cross-Month | `Asia/Tokyo` | `2026-01-01 09:00` | `NORMAL` | `2026-01-01T00:00:00Z` | `NORMAL` | `2026-01-01T00:00:00Z` | ✅ MATCH |
| **SMP-42** | Tokyo Normal & Cross-Month | `Asia/Tokyo` | `2026-02-28 23:59` | `NORMAL` | `2026-02-28T14:59:00Z` | `NORMAL` | `2026-02-28T14:59:00Z` | ✅ MATCH |
| **SMP-43** | Tokyo Normal & Cross-Month | `Asia/Tokyo` | `2026-03-01 00:00` | `NORMAL` | `2026-02-28T15:00:00Z` | `NORMAL` | `2026-02-28T15:00:00Z` | ✅ MATCH |
| **SMP-44** | Tokyo Normal & Cross-Month | `Asia/Tokyo` | `2026-06-01 09:00` | `NORMAL` | `2026-06-01T00:00:00Z` | `NORMAL` | `2026-06-01T00:00:00Z` | ✅ MATCH |
| **SMP-45** | Tokyo Normal & Cross-Month | `Asia/Tokyo` | `2026-12-31 23:59` | `NORMAL` | `2026-12-31T14:59:00Z` | `NORMAL` | `2026-12-31T14:59:00Z` | ✅ MATCH |
| **SMP-46** | UTC Normal & Cross-Month | `UTC` | `2026-01-01 00:00` | `NORMAL` | `2026-01-01T00:00:00Z` | `NORMAL` | `2026-01-01T00:00:00Z` | ✅ MATCH |
| **SMP-47** | UTC Normal & Cross-Month | `UTC` | `2026-02-28 23:59` | `NORMAL` | `2026-02-28T23:59:00Z` | `NORMAL` | `2026-02-28T23:59:00Z` | ✅ MATCH |
| **SMP-48** | UTC Normal & Cross-Month | `UTC` | `2026-03-01 00:00` | `NORMAL` | `2026-03-01T00:00:00Z` | `NORMAL` | `2026-03-01T00:00:00Z` | ✅ MATCH |
| **SMP-49** | UTC Normal & Cross-Month | `UTC` | `2026-06-15 12:00` | `NORMAL` | `2026-06-15T12:00:00Z` | `NORMAL` | `2026-06-15T12:00:00Z` | ✅ MATCH |
| **SMP-50** | UTC Normal & Cross-Month | `UTC` | `2026-12-31 23:59` | `NORMAL` | `2026-12-31T23:59:00Z` | `NORMAL` | `2026-12-31T23:59:00Z` | ✅ MATCH |

**统计汇总：**
- 总计样本数：50 个
- 完全匹配数：50 个 (100.0%)
- 不一致样本数：0 个 (0.0%)
- 0 候选（GAP）精确匹配：8 个
- 2 候选（FOLD）精确匹配：8 个
- 1 候选（NORMAL）精确匹配：34 个

---

## 4. MATH10 五大数学不变量验证结果

测试文件位于 [`tests/math/invariants.test.ts`](file:///home/hatch/workspace/p009-work/P009-timefold/03_source/tests/math/invariants.test.ts)。

### 4.1 不变量 1：6 个预设重算深度一致 (Deterministic Reproducibility)
- **验证方式**：对全部 6 个预设各自连续重算 5 次。
- **验证结果**：每次返回结构深层完全等价 (`toEqual`)；同时断言每次返回新对象引用，绝非单例缓存污染。
- **状态**：✅ PASS

### 4.2 不变量 2：导出→导入→重算输出一致 (JSON Roundtrip Invariant)
- **验证方式**：模拟真实应用导出与导入：`JSON.stringify(input)` 导出字符串，再 `JSON.parse` 导入后调用 `analyze(importedInput)` 重算。
- **覆盖对象**：全部 6 个官方预设以及 `shiftForward` / `earlier` / `later` 等策略变体。
- **验证结果**：重算输出与原始输入直算结果逐字段一致。
- **状态**：✅ PASS

### 4.3 不变量 3：候选反投到请求本地分钟（shiftForward 除外）(Candidate Reverse Projection)
- **验证方式**：
  - 对 6 个预设及 50 个样本产生的全部 candidate UTC 实例，利用分段表公式 $L(t) = t + O_i$ 反投回当地时间；
  - 断言 $L(t) \equiv \text{requestedLocal}$；
  - 对 `shiftForward` 模式产生的 `selectedUtc`，断言其反投回当地时间恰好等于顺延后的跳变恢复当地时间（如纽约 `03:00`、伦敦 `02:00`）。
- **验证结果**：所有候选反投结果 100% 严密回投。
- **状态**：✅ PASS

### 4.4 不变量 4：输入冻结对象无变异 (Deep Object Freeze Immutability)
- **验证方式**：对输入对象及其所有多层嵌套属性（`zone`, `segments`, `schedule`, `policy`）执行递归深度 `Object.freeze`，然后传入 `analyze` 及 `validateInput`。
- **验证结果**：运行时未触发任何属性修改报错 (`TypeError: Cannot assign to read only property`)，证明分析引擎为严格纯函数无副作用。
- **状态**：✅ PASS

### 4.5 不变量 5：runId 旧结果不污染新结果 (Worker Protocol & RunId Concurrency)
- **验证方式**：
  - 纯函数并发隔离：高频交替轮换调用 TF-A、TF-B、TF-E、TF-F 达 100 次，验证各次计算互不干扰；
  - 协议守卫校验：验证 `isWorkerRequest` 与 `isWorkerResponse` 精确识别有效与恶意格式；
  - 模拟主线程状态机：模拟请求 1 (runId=1) 发出后用户立即发起请求 2 (runId=2)，随后迟滞到达的 runId=1 结果被严格过滤丢弃，仅有效活跃 runId=2 提交状态；取消操作立即清空 activeRunId。
- **验证结果**：无任何竞态或历史污染。
- **状态**：✅ PASS

---

## 5. 敏感性检错证明记录 (Sensitivity Proof)

为证明独立 Oracle 具有真正的检错能力、杜绝无意义假阳性（false positive），在临时测试 [`tests/oracle/sensitivity.test.ts`](file:///home/hatch/workspace/p009-work/P009-timefold/03_source/tests/oracle/sensitivity.test.ts) 中人为注入了典型缺陷：

### 5.1 缺陷注入与运行结果
1. **注入缺陷 1（候选时间偏移 1 分钟）**：
   - 在 TF-B（纽约回拨）中，故意将第一个候选时间修改为 `2026-11-01T05:31:00Z`（正确为 `05:30:00Z`）。
   - **断言失败日志**：
     ```text
     FAIL tests/oracle/sensitivity.test.ts > T008 敏感性证明：故意引入错误应使断言明确失败 > 注入缺陷 1：若内核产生偏差 +1 分钟的错误候选，Oracle 必失败
     AssertionError: expected [ '2026-11-01T05:31:00Z', …(1) ] to deeply equal [ '2026-11-01T05:30:00Z', …(1) ]
     - Expected
     + Received
       [
     -   "2026-11-01T05:30:00Z",
     +   "2026-11-01T05:31:00Z",
         "2026-11-01T06:30:00Z",
       ]
     ```
2. **注入缺陷 2（GAP 状态误判与虚构候选）**：
   - 在 TF-A（纽约春季缺口 `02:30`）中，故意模拟内核将其误判为 `NORMAL` 并返回虚构时间 `07:30Z`。
   - **断言失败日志**：
     ```text
     FAIL tests/oracle/sensitivity.test.ts > T008 敏感性证明：故意引入错误应使断言明确失败 > 注入缺陷 2：若内核将 GAP 状态误判为 NORMAL 并虚构候选，Oracle 必失败
     AssertionError: expected 'NORMAL' to be 'GAP' // Object.is equality
     Expected: "GAP"
     Received: "NORMAL"
     ```
3. **敏感性执行退出码**：
   - 命令：`npx vitest run tests/oracle/sensitivity.test.ts`
   - 实际退出码：`1`（断言失败，阻断机制有效）。
4. **清理记录**：
   - 验证完成后已立即执行 `rm -f tests/oracle/sensitivity.test.ts` 彻底删除该临时文件，确保工作区和仓库保持完全纯净，零污染。

---

## 6. 真实命令验收记录与结论

在工作目录 `03_source` 执行最终正式验收命令：

```bash
npm run test:math && npm run test && npm run typecheck
```

- `npm run test:math`：退出码 **0**（9 个测试套件，176 个测试用例全部 PASS）
- `npm run test`：退出码 **0**（9 个测试套件，176 个测试用例全部 PASS）
- `npm run typecheck` (`tsc --noEmit`)：退出码 **0**（严格模式下 0 错误）

**最终结论：**
MATH01 至 MATH10 全部强制项真实通过，独立 Oracle 与内核 50 样本比对零误差，五大不变量全部通过，敏感性检错成立，T008 任务圆满交付。
