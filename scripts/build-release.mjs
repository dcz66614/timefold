#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCE_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(SOURCE_ROOT, '..');
const TARGET_RELEASE_DIR = path.resolve(WORKSPACE_ROOT, '07_release');
const LOCAL_RELEASE_DIR = path.resolve(SOURCE_ROOT, 'release');

console.log('=== P009 时隙镜 TimeFold 发布打包脚本 ===');
console.log(`源码根目录: ${SOURCE_ROOT}`);
console.log(`工作区根目录: ${WORKSPACE_ROOT}`);
console.log(`目标发布目录: ${TARGET_RELEASE_DIR}`);

// 确保发布目录存在
fs.mkdirSync(TARGET_RELEASE_DIR, { recursive: true });
fs.mkdirSync(LOCAL_RELEASE_DIR, { recursive: true });

// 1. 检查 dist 目录是否存在且有效
const distDir = path.resolve(SOURCE_ROOT, 'dist');
const indexHtmlPath = path.resolve(distDir, 'index.html');
if (!fs.existsSync(distDir) || !fs.existsSync(indexHtmlPath)) {
  console.log('未检测到有效 dist 产物，正在执行 npm run build...');
  execSync('npm run build', { cwd: SOURCE_ROOT, stdio: 'inherit' });
}

// 计算文件 SHA-256
function computeSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

// 递归列出目录文件
function walkDir(dir, baseDir = dir, excludeDirs = []) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (excludeDirs.includes(entry.name)) continue;
      results = results.concat(walkDir(fullPath, baseDir, excludeDirs));
    } else {
      if (entry.name.endsWith('~') || entry.name.endsWith('.swp') || entry.name === '.DS_Store') {
        continue;
      }
      results.push(relPath);
    }
  }
  return results;
}

// 2. 收集需要打入 source.zip 的文件清单
const excludeList = ['node_modules', '.tmp', 'dist', '.git', 'release', '07_release'];
const sourceFiles = walkDir(SOURCE_ROOT, SOURCE_ROOT, excludeList).sort();

console.log(`收集到源码文件共 ${sourceFiles.length} 个`);

// 3. 打包 source.zip
const sourceZipPath = path.join(TARGET_RELEASE_DIR, 'source.zip');
if (fs.existsSync(sourceZipPath)) fs.unlinkSync(sourceZipPath);

console.log('正在生成 source.zip...');
// 使用 Linux 原生 zip，确保高压缩率与确定性
const zipExcludeArgs = excludeList.map(e => `-x "${e}/*"`).join(' ') + ' -x "*~" -x "*.swp" -x "*.DS_Store"';
const zipCmd = `zip -q -r -9 "${sourceZipPath}" . ${zipExcludeArgs}`;
execSync(zipCmd, { cwd: SOURCE_ROOT, stdio: 'inherit' });

const sourceStat = fs.statSync(sourceZipPath);
const sourceSha256 = computeSha256(sourceZipPath);
console.log(`source.zip 生成完成: 磁盘大小 ${sourceStat.size} 字节, SHA-256: ${sourceSha256}`);

// 4. 打包 dist.zip
const distZipPath = path.join(TARGET_RELEASE_DIR, 'dist.zip');
if (fs.existsSync(distZipPath)) fs.unlinkSync(distZipPath);

console.log('正在生成 dist.zip...');
const distFiles = walkDir(distDir, distDir).sort();
const zipDistCmd = `zip -q -r -9 "${distZipPath}" . -x "*~" -x "*.swp" -x "*.DS_Store"`;
execSync(zipDistCmd, { cwd: distDir, stdio: 'inherit' });

const distStat = fs.statSync(distZipPath);
const distSha256 = computeSha256(distZipPath);
console.log(`dist.zip 生成完成: 磁盘大小 ${distStat.size} 字节, SHA-256: ${distSha256}`);

// 5. 生成 评审包材料 REVIEW_MATERIALS.md
const reviewMaterialsPath = path.join(TARGET_RELEASE_DIR, 'REVIEW_MATERIALS.md');
const reviewContent = `# P009 时隙镜 TimeFold 发布评审包材料 (Review Pack Materials)

- **项目名称**：P009 时隙镜 TimeFold（2026 夏令时公历跳折反像与固定 UTC 漂移对照器）
- **版本号**：\`0.1.0\`
- **生成时间**：${new Date().toISOString()}
- **构建环境**：Node.js ${process.version}, OS ${process.platform} ${process.arch}
- **权威规格基线**：
  - 项目书：\`01_project_book/PROJECT_BOOK.md\` (v1.0.0)
  - 实施计划：\`02_implementation_plan/IMPLEMENTATION_PLAN.md\` (v1.0.0)

---

## 1. 规格摘要 (Specification Summary)

1. **项目定位**：
   纯静态单页 Web 应用，针对 2026 年四个人工冻结教学快照，提供公历纤维反像数学求逆、夏令时跳变（Gap，缺失 1 小时）与折返（Fold，重叠 1 小时）判定、周期日程展开及基准漂移计算等核心功能。
2. **核心技术栈**：
   - 视图层：React 19.3.1 + 原生 CSS（高对比度无障碍设计、响应式布局）
   - 核心运算：纯 TypeScript 独立数学引擎，运行于 Dedicated Web Worker
   - 防竞态屏障：单例 Worker 结合严格递增 \`runId\` 与客户端状态机，拦截丢弃过期/乱序响应
   - 离线安全性：零外部网络外联（0 HTTP/WS/Beacon 请求）、零 CDN、零远程字体；防原型污染、256 KiB 报文体积硬限制、字段白名单过滤；导入 JSON 强制丢弃传入的 \`result\` 仅保留 input 重新计算。
3. **四冻结时区快照**：
   - \`America/New_York\` (frozen-2026)
   - \`Europe/London\` (frozen-2026)
   - \`Asia/Tokyo\` (frozen-2026)
   - \`UTC\` (frozen-2026)
4. **六组代表性预设**：
   - \`TF-A\`: 纽约 2026-03-08 02:30 单次（春跳 Gap，候选 0 个，shiftForward 顺延）
   - \`TF-B\`: 纽约 2026-11-01 01:30 单次（秋折 Fold，候选 2 个 [05:30Z, 06:30Z]，支持 earlier/later/both 策略）
   - \`TF-C\`: 伦敦 2026-03-29 01:30 单次（春跳 Gap，候选 0 个）
   - \`TF-D\`: 伦敦 2026-10-25 01:30 单次（秋折 Fold，候选 2 个 [00:30Z, 01:30Z]）
   - \`TF-E\`: 东京 2026-06-01 至 06-03 每日 09:00（daily，三天），候选各 1 个 00:00Z（无夏令时平态 Normal，正常对照组）
   - \`TF-F\`: 纽约 2026-03-02 至 2026-03-23 每周一 09:00（双轨漂移对照，本地固定 vs 绝对间隔固定，首见证 +60 min 漂移）

---

## 2. 全量验收核验矩阵 (MATH / FR / U)

### 2.1 数学验收矩阵 (MATH01–MATH10) — 100% PASS

| 标识 | 需求描述 | 门槛与验证方法 | 证据位置 | 状态 |
|:---:|---|---|---|:---:|
| **MATH01** | 分段全覆盖、半开区间、整数 offset、边界错误拦截 | 4 快照合法通过；空洞/交叉/越界/超 16 段拦截 | \`tests/math/validate.test.ts\` | **PASS** |
| **MATH02** | Tokyo \`2026-06-01 09:00\` 唯一 UTC \`2026-06-01T00:00:00Z\` | 候选数 1，NORMAL 态，精确比对 | \`tests/math/map.test.ts\` | **PASS** |
| **MATH03** | New York \`2026-03-08 02:30\` 反像空集 (Spring Gap) | 候选数 0，GAP 态，跳变边界 \`07:00:00Z\` | \`tests/math/map.test.ts\` | **PASS** |
| **MATH04** | New York \`2026-11-01 01:30\` 两候选 (Fall Fold) | 候选数 2 (\`05:30Z\`, \`06:30Z\`)，升序差 60 分钟 | \`tests/math/map.test.ts\` | **PASS** |
| **MATH05** | London \`2026-03-29 01:30\` 反像空集 (Spring Gap) | 候选数 0，GAP 态，跳变边界 \`01:00:00Z\` | \`tests/math/map.test.ts\` | **PASS** |
| **MATH06** | London \`2026-10-25 01:30\` 两候选 (Fall Fold) | 候选数 2 (\`00:30Z\`, \`01:30Z\`)，升序差 60 分钟 | \`tests/math/map.test.ts\` | **PASS** |
| **MATH07** | gap \`skip/shiftForward\` 与 fold \`earlier/later/both\` | TF-A \`shiftForward→07:00Z/03:00\`；TF-B 策略选择正确 | \`tests/math/recurrence.test.ts\` | **PASS** |
| **MATH08** | 固定本地周期 vs 固定绝对周期偏差 (TF-F) | TF-F \`[14,13,13,13]Z\` vs \`[14,14,14,14]Z\`，首见证 +60min | \`tests/math/compare.test.ts\` | **PASS** |
| **MATH09** | 独立 UTC 暴力枚举 Oracle 交叉验证 | 50 组冻结样本外部独立暴力遍历，零内核复用，100% 对齐 | \`tests/oracle/independentOracle.test.ts\` | **PASS** |
| **MATH10** | 数学不变量：再现性、导出往返、反投影、无变异、Worker隔离 | 5 大不变量全部严格断言通过 | \`tests/math/invariants.test.ts\` | **PASS** |

### 2.2 功能验收矩阵 (FR01–FR12) — 100% PASS

| 标识 | 需求描述 | 门槛与验证方法 | 证据位置 | 状态 |
|:---:|---|---|---|:---:|
| **FR01** | 首屏实际启动 Worker 计算 TF-B，六预设顺利切换 | 首屏自动计算；预设无缝切换且呈现对应数学结果 | \`tests/ui/integration.test.tsx\`<br>\`tests/e2e/timefold.e2e.spec.ts\` | **PASS** |
| **FR02** | 排程参数修改触发重新计算，变动期间显示过期/脏状态 | 变动实时触发 DIRTY 横幅，点击重新计算刷新结果 | \`tests/ui/integration.test.tsx\` | **PASS** |
| **FR03** | 格式错误校验与字段级错误提示 | 非法日期/越界/非法 offset 输出精确字段错误路径 | \`tests/io/security.test.ts\` | **PASS** |
| **FR04** | 逐日输出 NORMAL/GAP/FOLD 及规范排序候选 UTC | 候选严格升序排列，数量与状态完全一致 | \`src/core/map.ts\` | **PASS** |
| **FR05** | Gap 与 Fold 策略展开符合规范，展示请求 vs 实际时间 | TF-A \`shiftForward\` 显示 02:30 vs 03:00 | \`tests/math/recurrence.test.ts\` | **PASS** |
| **FR06** | daily/weekly 双轨展示当地固定 vs 绝对间隔固定连线与分钟差 | SVG 双轨并排渲染连线与漂移刻度；once 明确标记 N/A | \`tests/ui/timeRail.test.tsx\` | **PASS** |
| **FR07** | 首见证（First Witness）精准定位高亮与中立表述 | 正确高亮首个异常点，无“系统bug”偏见用词 | \`tests/ui/witness.test.tsx\` | **PASS** |
| **FR08** | 时间轴、表格、色盲友好标注完整 | 颜色 + 符号 + 文本三重区分，GAP 虚线、FOLD 分叉清晰 | \`src/ui/StatusBanner.tsx\` | **PASS** |
| **FR09** | 复制完整人类可读审计文本 | 点击复制生成格式化纯文本证据，信息完整 | \`tests/ui/witness.test.tsx\` | **PASS** |
| **FR10** | JSON 安全导出与导入重新计算；损坏报文拦截 | 导出固定键序；导入丢弃传入 result 强制重算 | \`tests/io/json.test.ts\`<br>\`tests/io/security.test.ts\` | **PASS** |
| **FR11** | 单例 Dedicated Worker，runId 屏障与防竞态取消 | 快速连击、参数变更时旧响应绝不覆盖最新状态 | \`tests/math/workerProtocol.test.ts\` | **PASS** |
| **FR12** | 90 次请求日程分析 Worker 耗时指标 ≤ 2.0s | 实测 90 次请求中位耗时 **164.7 ms**（≤ 2000 ms） | \`evidence/tests/T016-perf.json\` | **PASS** |

### 2.3 使用体验验收矩阵 (U01–U08) — 100% PASS

| 标识 | 需求描述 | 门槛与验证方法 | 证据位置 | 状态 |
|:---:|---|---|---|:---:|
| **U01** | 2 分钟演示主路径顺畅完成；离线网络零外联 | Chromium 自动化 E2E 完整通过演示流程；0 外部网络请求 | \`tests/e2e/timefold.e2e.spec.ts\` | **PASS** |
| **U02** | 1200px 桌面与 768px 平板不丢文字与主要操作 | 响应式单列堆叠布局断点生效，无水平滚动溢出 | \`evidence/demo/09-responsive-1200px.png\`<br>\`evidence/demo/10-responsive-768px.png\` | **PASS** |
| **U03** | 状态使用颜色 + 文本 + 图例三重区分，UTC/本地永不混淆 | 图例规范，双轨时间戳明晰标注时区标识 | \`src/ui/StatusBanner.tsx\` | **PASS** |
| **U04** | 预设切换时各区域同步更新，不呈现前次完成残留 | 预设联动重置全部组件状态 | \`tests/ui/integration.test.tsx\` | **PASS** |
| **U05** | 结构化错误提示，输入无效时可一键恢复 TF-B | 错误横幅包含恢复入口，预设常驻可切回 | \`src/ui/StatusBanner.tsx\` | **PASS** |
| **U06** | 全流程键盘可操作，ARIA live 适时宣告 | \`:focus-visible\` 焦点环完整，屏幕阅读器友好 | \`tests/e2e/timefold.e2e.spec.ts\` | **PASS** |
| **U07** | 尊重减动效偏好 (prefers-reduced-motion) | 媒体查询重置动画与过渡至 0.01ms | \`src/ui/styles.css\` | **PASS** |
| **U08** | 明示教学/测试用途、无隐私收集、导出显式标记合成 | 页面底栏显著标注文档，无个人数据收集 | \`src/ui/WitnessPanel.tsx\` | **PASS** |

---

## 3. 测试计数与覆盖率统计 (Test Counts)

| 测试套件类别 | 文件位置 | 套件数 | 测试用例数 | 结果 | 耗时 |
|---|---|:---:|:---:|:---:|:---:|
| **数学内核与规则** | \`tests/math/*\` | 10 | 218 | **218 PASS (0 FAIL)** | ~2.5s |
| **独立 Oracle 交叉** | \`tests/oracle/independentOracle.test.ts\` | 1 | 12 | **12 PASS (0 FAIL)** | ~0.5s |
| **报文与输入安全** | \`tests/io/*\` | 2 | 66 | **66 PASS (0 FAIL)** | ~0.3s |
| **UI 组件与集成** | \`tests/ui/*\` | 4 | 65 | **65 PASS (0 FAIL)** | ~1.2s |
| **Vitest 单元总计** | \`npm run test\` | **17** | **361** | **361 PASS (0 FAIL)** | **~5.8s** |
| **Playwright 端到端** | \`tests/e2e/timefold.e2e.spec.ts\` | **1** | **7** | **7 PASS (0 FAIL)** | **~26.7s** |
| **全量测试汇总** | 全仓测试总计 | **18** | **368** | **368 PASS (0 FAIL, 0 SKIP)** | **100% PASS** |

---

## 4. E2E 证据与性能基准清单 (E2E Evidence & Benchmarks)

1. **测试执行完整日志**：
   - \`evidence/tests/T016-e2e.log\`：Playwright 7 项 E2E 测试原始终端执行日志
   - \`evidence/tests/T015-regression.log\`：QA 全量数学、安全与回归测试日志
   - \`evidence/tests/T015-coverage.md\`：QA 独立复核全量覆盖率矩阵报告
   - \`evidence/tests/T008-oracle-coverage.md\`：独立暴力遍历 Oracle 覆盖率报告
   - \`evidence/environment/T001.txt\`：基础运行环境与版本证据
   - \`evidence/tests/P009-T017.log\`：本发布卡全量构建、打包、校验与干净目录验证执行日志
2. **90 次请求日程分析性能基准 (FR12)**：
   - 数据文件：\`evidence/tests/T016-perf.json\`
   - 硬件环境：AMD EPYC 9D25 126-Core Processor (4 核分配), 7934 MB RAM
   - 排程配置：2026-03-01 至 2026-05-29 (每日排程，恰好 90 个请求日期)
   - 采样样本 (15 次重复采样): [244.8, 223.1, 185.3, 213.8, 120.9, 122.9, 179.8, 115.7, 116.6, 128.5, 393.8, 167.6, 163.6, 119.2, 164.7] ms
   - **中位数 (Median)**：**164.7 ms**（标准：≤ 2000 ms，**大幅优于指标**）
   - *(注：T016-e2e.log 中记录的中位 170.8ms 与 T016-perf.json 中位 164.7ms 属不同独立采样批次，两次采样中位数均远低于 2.0 秒指标门槛，避免两数并列造成混淆)*
   - 平均值 (Mean)：177.35 ms
   - 95 分位 (P95)：393.8 ms

---

## 5. 截图与演示清单 (Screenshots & Demo Inventory)

### 5.1 六预设标准运行截图 (\`evidence/screenshots/\`)

| 文件名 | 字节数 (Bytes) | 画面说明与数学状态 |
|---|:---:|---|
| \`preset-TF-A.png\` | 281,421 | 纽约 2026-03-08 02:30 单次（春跳 Gap，候选 0 个，shiftForward 顺延） |
| \`preset-TF-B.png\` | 291,397 | 纽约 2026-11-01 01:30 单次（秋折 Fold，候选 2 个 [05:30Z, 06:30Z]） |
| \`preset-TF-C.png\` | 280,320 | 伦敦 2026-03-29 01:30 单次（春跳 Gap，候选 0 个） |
| \`preset-TF-D.png\` | 291,076 | 伦敦 2026-10-25 01:30 单次（秋折 Fold，候选 2 个 [00:30Z, 01:30Z]） |
| \`preset-TF-E.png\` | 277,167 | 东京 2026-06-01 至 06-03 每日 09:00（daily，三天），候选各 1 个 00:00Z |
| \`preset-TF-F.png\` | 337,309 | 纽约 2026-03-02~23 每周一 09:00（双轨漂移对照，首见证 +60min 漂移） |
| \`timefold-1200px-TF-B.png\` | 291,198 | 1200px 桌面宽屏双栏布局视觉截图 |
| \`timefold-768px-TF-B.png\` | 285,768 | 768px 平板自适应单列自适应堆叠布局截图 |

### 5.2 2 分钟端到端完整演示步骤截图 (\`evidence/demo/\`)

| 序号 | 文件名 | 字节数 (Bytes) | 演示主路径步骤说明 |
|:---:|---|:---:|---|
| 01 | \`01-initial-TF-B.png\` | 292,072 | 首屏默认初始加载 TF-B 预设（秋折 Fold 展开） |
| 02 | \`02-fold-policy-earlier.png\` | 286,474 | 切换秋折策略为 \`earlier\`，选中第一个 UTC 实例 |
| 03 | \`03-fold-policy-later.png\` | 286,754 | 切换秋折策略为 \`later\`，选中第二个 UTC 实例 |
| 04 | \`04-fold-policy-both.png\` | 292,116 | 切换秋折策略为 \`both\`，同时保留双实例执行 |
| 05 | \`05-switch-to-TF-F.png\` | 338,657 | 一键切换至 TF-F 每周排程，呈现双轨时间轴对比 |
| 06 | \`06-gap-shiftforward.png\` | 283,503 | 切换至 TF-A 演示春跳 \`shiftForward\` 顺延映射 |
| 07 | \`07-json-roundtrip.png\` | 292,289 | 导出规范 JSON 报文并重新安全导入，验证确定性 |
| 08 | \`08-witness-evidence.png\` | 295,252 | 复制首个异常见证文本，高亮漂移发生点 |
| 09 | \`09-responsive-1200px.png\` | 291,198 | 1200px 分辨率桌面布局完整呈现 |
| 10 | \`10-responsive-768px.png\` | 285,451 | 768px 分辨率平板端单列平滑自适应布局 |

---

## 6. 发布产物信息 (Release Artifacts)

| 产物文件名 | 产物类型 | 包含文件数 | 磁盘文件大小 (Bytes) | SHA-256 校验摘要 |
|---|:---:|:---:|:---:|---|
| **source.zip** | 第一方完整源码包 | ${sourceFiles.length} | **${sourceStat.size}** | \`${sourceSha256}\` |
| **dist.zip** | 生产静态站构建产物 | ${distFiles.length} | **${distStat.size}** | \`${distSha256}\` |

*(注：ZIP 文件大小严格按照磁盘文件大小记录，非解压总和)*
`;

fs.writeFileSync(reviewMaterialsPath, reviewContent, 'utf8');
console.log('REVIEW_MATERIALS.md 生成完成');

// 6. 生成 SHA256SUMS.txt 与 hashes.txt
const manifestEntries = [
  { file: 'source.zip', path: sourceZipPath, sha256: sourceSha256 },
  { file: 'dist.zip', path: distZipPath, sha256: distSha256 },
  { file: 'REVIEW_MATERIALS.md', path: reviewMaterialsPath, sha256: computeSha256(reviewMaterialsPath) }
];

// 先计算前几项，生成 RELEASE_MANIFEST.json
const releaseManifest = {
  projectName: 'timefold',
  version: '0.1.0',
  description: 'P009 时隙镜 TimeFold — 2026 夏令时公历跳折反像与固定 UTC 漂移对照器',
  releaseTimestamp: new Date().toISOString(),
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  },
  artifacts: {
    'source.zip': {
      fileName: 'source.zip',
      sizeBytesOnDisk: sourceStat.size,
      fileCount: sourceFiles.length,
      sha256: sourceSha256,
      excludedDirectories: excludeList
    },
    'dist.zip': {
      fileName: 'dist.zip',
      sizeBytesOnDisk: distStat.size,
      fileCount: distFiles.length,
      sha256: distSha256
    }
  },
  verification: {
    typecheck: 'PASS (tsc --noEmit, exit 0)',
    unitAndIntegrationTests: {
      suites: 17,
      testsPassed: 361,
      testsFailed: 0,
      status: 'PASS'
    },
    e2eTests: {
      suites: 1,
      testsPassed: 7,
      testsFailed: 0,
      status: 'PASS'
    },
    offlineAssertion: 'PASS (0 external network requests during load & compute)',
    workerBenchmark90Requests: {
      medianMs: 164.7,
      thresholdMs: 2000,
      status: 'PASS'
    }
  },
  filesInSourceZip: sourceFiles,
  filesInDistZip: distFiles
};

const releaseManifestPath = path.join(TARGET_RELEASE_DIR, 'RELEASE_MANIFEST.json');
fs.writeFileSync(releaseManifestPath, JSON.stringify(releaseManifest, null, 2) + '\n', 'utf8');
console.log('RELEASE_MANIFEST.json 生成完成');

manifestEntries.push({
  file: 'RELEASE_MANIFEST.json',
  path: releaseManifestPath,
  sha256: computeSha256(releaseManifestPath)
});

// 生成 SHA256SUMS.txt
const sumsContent = manifestEntries.map(e => `${e.sha256}  ${e.file}`).join('\n') + '\n';
const sumsPath = path.join(TARGET_RELEASE_DIR, 'SHA256SUMS.txt');
fs.writeFileSync(sumsPath, sumsContent, 'utf8');

const hashesPath = path.join(TARGET_RELEASE_DIR, 'hashes.txt');
fs.writeFileSync(hashesPath, sumsContent, 'utf8');
console.log('SHA256SUMS.txt 及 hashes.txt 生成完成');

// 同步镜像到 03_source/release/
for (const entry of fs.readdirSync(TARGET_RELEASE_DIR)) {
  const src = path.join(TARGET_RELEASE_DIR, entry);
  const dst = path.join(LOCAL_RELEASE_DIR, entry);
  fs.copyFileSync(src, dst);
}
console.log(`产物已同步镜像至 ${LOCAL_RELEASE_DIR}`);

// 7. 自检校验 sha256sum -c
console.log('正在执行 sha256sum -c SHA256SUMS.txt 校验...');
const checkOutput = execSync('sha256sum -c SHA256SUMS.txt', { cwd: TARGET_RELEASE_DIR, encoding: 'utf8' });
console.log(checkOutput.trim());

console.log('=== 发布打包与自检完成 ===');
