# P009 时隙镜 TimeFold

**2026 夏令时公历跳折反像与固定 UTC 漂移对照器**  
*A reproducible client-side tool for 2026 Gregorian DST Spring Gap / Fall Fold fiber inverse mapping & fixed UTC drift audit.*

---

## 1. 项目简介 (Overview)

时隙镜（TimeFold）是一个纯静态、零外部网络依赖的夏令时（DST）公历日程审计与反像映射对照工具。

在跨越夏令时切换边界的本地排程中，常规日历逻辑往往因为时区“跳变（Gap，缺失 1 小时）”与“折返（Fold，重叠 1 小时）”产生歧义或偶发重跑/漏跑事故。本项目针对 2026 年四个人工冻结教学快照，提供公历纤维反像数学求逆、策略展开（`skip`/`shiftForward`、`earlier`/`later`/`both`）、本地日历周期与固定绝对 UTC 周期双轨对照，以及首个异常见证（First Witness）溯源能力。

### 核心特性
- **纯前端零外联**：无任何服务端、无遥测（telemetry）、无远程 CDN 脚本与外链字体，100% 离线运行。
- **独立 Dedicated Web Worker**：所有数学重算在后台 Worker 中执行，具备基于 `runId` 的状态机屏障，杜绝快速切换输入时的乱序覆盖。
- **严格输入安全**：具备原型污染防御、256 KiB 报文体积硬限制、字段白名单校验；导入 JSON 强制丢弃非置信计算结果，完全依赖内核现场重算。
- **四冻结时区快照**：
  - `America/New_York` (frozen-2026)
  - `Europe/London` (frozen-2026)
  - `Asia/Tokyo` (frozen-2026)
  - `UTC` (frozen-2026)
- **六组代表性预设**：TF-A 至 TF-F 全量内置，覆盖春跳、秋折、跨时区、平年对照以及固定本地周期 vs 固定绝对周期的发散对照。

---

## 2. 架构概览 (Architecture)

```
03_source/
├── src/
│   ├── core/         # 纯 TypeScript 数学内核：公历算术、分段反像求逆、周期生成、不变量与合法性校验
│   ├── data/         # 6 组人工冻结预设数据 (TF-A ~ TF-F)
│   ├── io/           # 安全 JSON 序列化与反序列化，防原型污染与白名单校验
│   ├── ui/           # React 19 UI 组件：双轨时间轴 (TimeRail)、排程编辑器、见证面板与审计表格
│   └── worker/       # Dedicated Worker 协议、后台计算引擎与客户端防竞态状态机
├── tests/
│   ├── e2e/          # Playwright 离线断言、响应式、无障碍与 90 请求 Worker 性能基准测试
│   ├── fixtures/     # 冻结测试用例与黄金 JSON
│   ├── io/           # 报文安全边界与原型污染防御测试
│   ├── math/         # 数学映射、日程展开、不变量与回归测试
│   └── oracle/       # 独立 UTC 分钟遍历暴力 Oracle 交叉比对
├── evidence/         # 完整测试日志、E2E 截图、2分钟演示录屏与性能数据
├── scripts/          # 发布打包脚本 (build-release.mjs)
├── LICENSE           # MIT 许可证
├── THIRD_PARTY_NOTICES.md # 第三方开源软件声明
└── package.json
```

---

## 3. 环境要求与安装 (Requirements & Setup)

### 3.1 环境要求
- **Node.js**：`24.x`（推荐 `v24.22.x` 以上 LTS）
- **npm**：`10.x` 以上
- **操作系统**：Linux、macOS 或 Windows（标准现代化浏览器，无服务端运行时）

### 3.2 安装依赖
```bash
# 使用 package-lock.json 严格对齐依赖
npm ci
```

---

## 4. 运行与验证命令 (Commands)

```bash
# 1. 静态类型契约检查
npm run typecheck

# 2. 运行核心数学与独立 Oracle 交叉测试
npm run test:math

# 3. 运行全量单元与集成测试 (17 个套件, 361 项用例)
npm run test

# 4. 生产静态产物构建 (输出至 dist/)
npm run build

# 5. 离线端到端测试与性能基准
npm run test:e2e

# 6. 本地开发预览服务
npm run dev

# 7. 生产发布打包 (生成源码 ZIP, dist ZIP, SHA-256 清单与评审包)
npm run release:bundle
```

---

## 5. 六组冻结预设 (Frozen Presets)

| 预设 ID | 时区与规则 | 特征与数学验证点 |
|:---:|---|---|
| **TF-A** | `America/New_York` 2026-03-08 02:30 单次 | **Spring Gap（缺失跳变）**：反像为空集；`shiftForward` 顺延至 03:00 (07:00Z) |
| **TF-B** | `America/New_York` 2026-11-01 01:30 单次 | **Fall Fold（秋季重叠）**：反像存在 2 个时刻 (`05:30Z`, `06:30Z`)；支持 `earlier/later/both` 策略选择 |
| **TF-C** | `Europe/London` 2026-03-29 01:30 单次 | **Spring Gap**：反像为空集；`shiftForward` 顺延至 02:00 (01:00Z) |
| **TF-D** | `Europe/London` 2026-10-25 01:30 单次 | **秋折**：反像存在 2 个时刻 (`00:30Z`, `01:30Z`) |
| **TF-E** | `Asia/Tokyo` 2026-06-01 至 2026-06-03 每日 09:00（daily，三天） | **无夏令时基线**：每日候选各 1 个时刻 (`00:00:00Z`)，正常对照组 |
| **TF-F** | `America/New_York` 2026-03-02 至 2026-03-23 每周一 09:00 | **双轨漂移对照**：跨越春跳边界，固定本地周期 (14,13,13,13Z) vs 固定绝对周期 (14,14,14,14Z)，首见证漂移 `+60 min` |

---

## 6. 使用边界与教学声明 (Limitations & Disclaimer)

- **非生产调度器**：本项目为教学验证、规则设计审计与排程测试工具，不包含 CRON Daemon 或实时任务触发引擎。
- **时区快照静态性**：时区数据基于 2026 冻结分段，不随外部 IANA tzdb 动态拉取，以确保全流程可复现性与离线零外联安全。
- **合成数据**：内置示例与输入均属于合成规则，不收集用户日历或个人隐私。
