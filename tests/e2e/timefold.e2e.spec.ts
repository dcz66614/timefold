import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TMP_DIR = path.resolve(ROOT_DIR, '.tmp');
const DEMO_DIR = path.resolve(ROOT_DIR, 'evidence/demo');
const SCREENSHOTS_DIR = path.resolve(ROOT_DIR, 'evidence/screenshots');
const TESTS_EVIDENCE_DIR = path.resolve(ROOT_DIR, 'evidence/tests');

// Ensure output directories exist
for (const dir of [TMP_DIR, DEMO_DIR, SCREENSHOTS_DIR, TESTS_EVIDENCE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

test.describe.configure({ mode: 'serial' });

test.describe('P009 时隙镜 TimeFold 端到端测试 (E2E)', () => {
  test.beforeEach(async ({ context }) => {
    // Grant clipboard permissions for copy evidence testing
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {
      // Ignore if not supported in headless mode
    });
  });

  // =========================================================================
  // 1. 离线断言与零外部网络请求 (FR12, OFFLINE)
  // =========================================================================
  test('1. 离线断言：加载与计算全程零外部网络请求', async ({ page }) => {
    const externalRequests: string[] = [];
    const localRequests: string[] = [];

    // Intercept and log all network requests
    await page.route('**', (route) => {
      const url = route.request().url();
      if (
        url.startsWith('http://127.0.0.1:4173') ||
        url.startsWith('http://localhost:4173') ||
        url.startsWith('data:') ||
        url.startsWith('blob:')
      ) {
        localRequests.push(url);
        route.continue();
      } else {
        externalRequests.push(url);
        route.abort('failed');
      }
    });

    await page.goto('/');

    // Verify status transitions to READY
    const readyBadge = page.locator('.status-badge.status-ready');
    await expect(readyBadge).toBeVisible({ timeout: 10000 });
    await expect(readyBadge).toContainText('READY');

    // Verify top header OFFLINE / SYNTHETIC / 2026 SNAPSHOT badges
    await expect(page.locator('.brand-section')).toContainText('OFFLINE');
    await expect(page.locator('.brand-section')).toContainText('SYNTHETIC');
    await expect(page.locator('.brand-section')).toContainText('2026 SNAPSHOT');
    await expect(page.locator('.brand-section')).toContainText('TIMEFOLD');
    await expect(page.locator('.brand-section')).toContainText('P009');

    // Trigger calculation to verify runtime worker does not send external requests
    const runBtn = page.locator('button.btn-primary', { hasText: '运行分析' });
    await runBtn.click();
    await expect(readyBadge).toBeVisible();

    // Assert strictly zero external network requests
    expect(externalRequests).toEqual([]);
    expect(localRequests.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // 2. 首屏 TF-B 与六预设切换 (FR01, FR04, FR08, U01)
  // =========================================================================
  test('2. 首屏默认加载 TF-B，六预设顺利切换并展示对应数学结果与截图', async ({ page }) => {
    await page.goto('/');
    const readyBadge = page.locator('.status-badge.status-ready');
    await expect(readyBadge).toBeVisible({ timeout: 10000 });

    // 2.1 首屏 TF-B 断言
    const activePresetBtn = page.locator('.preset-button.active');
    await expect(activePresetBtn).toContainText('TF-B');
    await expect(page.locator('[data-testid="audit-requested-0"]')).toHaveText('2026-11-01 01:30');
    await expect(page.locator('[data-testid="status-badge-fold"]')).toBeVisible();
    await expect(page.locator('[data-testid="audit-candidates-0"]')).toContainText('2026-11-01T05:30:00Z');
    await expect(page.locator('[data-testid="audit-candidates-0"]')).toContainText('2026-11-01T06:30:00Z');
    await expect(page.locator('[data-testid="audit-selected-0"]')).toContainText('2026-11-01T05:30:00Z, 2026-11-01T06:30:00Z');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('FOLD');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('2026-11-01');

    await page.screenshot({ path: path.resolve(SCREENSHOTS_DIR, 'preset-TF-B.png'), fullPage: true });
    await page.screenshot({ path: path.resolve(DEMO_DIR, 'preset-TF-B.png'), fullPage: true });

    // 2.2 切换 TF-A (纽约春季跳时缺口)
    await page.locator('.preset-button', { hasText: 'TF-A' }).click();
    await expect(readyBadge).toBeVisible();
    await expect(page.locator('.preset-button.active')).toContainText('TF-A');
    await expect(page.locator('[data-testid="audit-requested-0"]')).toHaveText('2026-03-08 02:30');
    await expect(page.locator('[data-testid="status-badge-gap"]')).toBeVisible();
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('GAP');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('2026-03-08');
    await page.screenshot({ path: path.resolve(SCREENSHOTS_DIR, 'preset-TF-A.png'), fullPage: true });
    await page.screenshot({ path: path.resolve(DEMO_DIR, 'preset-TF-A.png'), fullPage: true });

    // 2.3 切换 TF-C (伦敦春季缺口)
    await page.locator('.preset-button', { hasText: 'TF-C' }).click();
    await expect(readyBadge).toBeVisible();
    await expect(page.locator('.preset-button.active')).toContainText('TF-C');
    await expect(page.locator('#editor-zone-select')).toHaveValue('Europe/London');
    await expect(page.locator('[data-testid="audit-requested-0"]')).toHaveText('2026-03-29 01:30');
    await expect(page.locator('[data-testid="status-badge-gap"]')).toBeVisible();
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('GAP');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('2026-03-29');
    await page.screenshot({ path: path.resolve(SCREENSHOTS_DIR, 'preset-TF-C.png'), fullPage: true });
    await page.screenshot({ path: path.resolve(DEMO_DIR, 'preset-TF-C.png'), fullPage: true });

    // 2.4 切换 TF-D (伦敦秋季重叠)
    await page.locator('.preset-button', { hasText: 'TF-D' }).click();
    await expect(readyBadge).toBeVisible();
    await expect(page.locator('.preset-button.active')).toContainText('TF-D');
    await expect(page.locator('#editor-zone-select')).toHaveValue('Europe/London');
    await expect(page.locator('[data-testid="audit-requested-0"]')).toHaveText('2026-10-25 01:30');
    await expect(page.locator('[data-testid="status-badge-fold"]')).toBeVisible();
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('FOLD');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('2026-10-25');
    await page.screenshot({ path: path.resolve(SCREENSHOTS_DIR, 'preset-TF-D.png'), fullPage: true });
    await page.screenshot({ path: path.resolve(DEMO_DIR, 'preset-TF-D.png'), fullPage: true });

    // 2.5 切换 TF-E (东京每日对照常态)
    await page.locator('.preset-button', { hasText: 'TF-E' }).click();
    await expect(readyBadge).toBeVisible();
    await expect(page.locator('.preset-button.active')).toContainText('TF-E');
    await expect(page.locator('#editor-zone-select')).toHaveValue('Asia/Tokyo');
    await expect(page.locator('[data-testid="audit-request-count"]')).toHaveText('3');
    await expect(page.locator('[data-testid="status-badge-normal"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('NONE');
    await page.screenshot({ path: path.resolve(SCREENSHOTS_DIR, 'preset-TF-E.png'), fullPage: true });
    await page.screenshot({ path: path.resolve(DEMO_DIR, 'preset-TF-E.png'), fullPage: true });

    // 2.6 切换 TF-F (纽约每周一固定间隔漂移见证)
    await page.locator('.preset-button', { hasText: 'TF-F' }).click();
    await expect(readyBadge).toBeVisible();
    await expect(page.locator('.preset-button.active')).toContainText('TF-F');
    await expect(page.locator('#editor-zone-select')).toHaveValue('America/New_York');
    await expect(page.locator('[data-testid="audit-request-count"]')).toHaveText('4');
    // 4 weekly occurrences: 2026-03-02, 2026-03-09, 2026-03-16, 2026-03-23
    await expect(page.locator('[data-testid="audit-requested-0"]')).toHaveText('2026-03-02 09:00');
    await expect(page.locator('[data-testid="audit-requested-1"]')).toHaveText('2026-03-09 09:00');
    await expect(page.locator('[data-testid="audit-requested-2"]')).toHaveText('2026-03-16 09:00');
    await expect(page.locator('[data-testid="audit-requested-3"]')).toHaveText('2026-03-23 09:00');
    // Witness is DRIFT on 2026-03-09 with +60 min
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('DRIFT');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('2026-03-09');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('+60 min');
    await expect(page.locator('[data-testid="audit-drift-1"]')).toHaveText('+60 min');

    await page.screenshot({ path: path.resolve(SCREENSHOTS_DIR, 'preset-TF-F.png'), fullPage: true });
    await page.screenshot({ path: path.resolve(DEMO_DIR, 'preset-TF-F.png'), fullPage: true });
  });

  // =========================================================================
  // 3. 快速连续切换与 Worker 竞态隔离 (FR11, Race Condition)
  // =========================================================================
  test('3. 竞态测试：快速连续切换预设，最终结果严格与最后一次点击一致', async ({ page }) => {
    await page.goto('/');
    const readyBadge = page.locator('.status-badge.status-ready');
    await expect(readyBadge).toBeVisible({ timeout: 10000 });

    // 连续极速点击 TF-A -> TF-C -> TF-E -> TF-B -> TF-F，中途不等待
    await page.locator('.preset-button', { hasText: 'TF-A' }).click();
    await page.locator('.preset-button', { hasText: 'TF-C' }).click();
    await page.locator('.preset-button', { hasText: 'TF-E' }).click();
    await page.locator('.preset-button', { hasText: 'TF-B' }).click();
    await page.locator('.preset-button', { hasText: 'TF-F' }).click();

    // 等待计算彻底就绪
    await expect(readyBadge).toBeVisible();

    // 检查激活的预设严格为 TF-F
    await expect(page.locator('.preset-button.active')).toContainText('TF-F');

    // 检查表单与结果严格为 TF-F，未被前面被取消的旧 Worker 结果污染
    await expect(page.locator('#editor-zone-select')).toHaveValue('America/New_York');
    await expect(page.locator('#editor-local-time')).toHaveValue('09:00');
    await expect(page.locator('#editor-start-date')).toHaveValue('2026-03-02');
    await expect(page.locator('#editor-end-date')).toHaveValue('2026-03-23');
    await expect(page.locator('[data-testid="audit-request-count"]')).toHaveText('4');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('DRIFT');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('2026-03-09');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('+60 min');

    // 反向测试：连续极速点击 TF-F -> TF-E -> TF-D -> TF-C -> TF-A -> TF-B
    await page.locator('.preset-button', { hasText: 'TF-F' }).click();
    await page.locator('.preset-button', { hasText: 'TF-E' }).click();
    await page.locator('.preset-button', { hasText: 'TF-D' }).click();
    await page.locator('.preset-button', { hasText: 'TF-C' }).click();
    await page.locator('.preset-button', { hasText: 'TF-A' }).click();
    await page.locator('.preset-button', { hasText: 'TF-B' }).click();

    await expect(readyBadge).toBeVisible();
    await expect(page.locator('.preset-button.active')).toContainText('TF-B');
    await expect(page.locator('#editor-local-time')).toHaveValue('01:30');
    await expect(page.locator('[data-testid="audit-requested-0"]')).toHaveText('2026-11-01 01:30');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('FOLD');
  });

  // =========================================================================
  // 4. 键盘 Tab 导航与无障碍访问 (U06, Accessibility)
  // =========================================================================
  test('4. 键盘无障碍测试：Tab 键全程可达主要控件，支持键盘触发操作', async ({ page }) => {
    await page.goto('/');
    const readyBadge = page.locator('.status-badge.status-ready');
    await expect(readyBadge).toBeVisible({ timeout: 10000 });

    // 重置焦点到页面顶部
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.body.focus();
    });

    // 连续按 Tab 并记录聚焦元素标签与属性
    const focusedTags: string[] = [];
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      const focusedInfo = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id,
          className: el.className,
          testId: el.getAttribute('data-testid'),
          ariaLabel: el.getAttribute('aria-label'),
          text: (el.textContent || '').trim().slice(0, 30),
        };
      });
      if (focusedInfo) {
        focusedTags.push(`${focusedInfo.tagName}#${focusedInfo.id || focusedInfo.testId || focusedInfo.text}`);
      }
    }

    // 断言 Tab 能够遍历主要控制元素
    expect(focusedTags.length).toBeGreaterThan(10);

    // 验证键盘切换预设：Tab 到预设 TF-A 按钮并通过 Space/Enter 激活
    await page.locator('.preset-button', { hasText: 'TF-A' }).focus();
    await page.keyboard.press('Enter');
    await expect(readyBadge).toBeVisible();
    await expect(page.locator('.preset-button.active')).toContainText('TF-A');

    // 验证键盘修改策略：聚焦并勾选 shiftForward 单选框
    await page.locator('label', { hasText: '顺移 (shiftForward)' }).click();
    // 断言状态进入 DIRTY
    await expect(page.locator('.status-badge.status-dirty')).toBeVisible();
    // B01 回归核验：DIRTY 状态下顶栏导出按钮必须被禁用
    await expect(page.locator('[data-testid="export-json-button"]')).toBeDisabled();

    // 验证键盘触发运行分析：聚焦到运行分析按钮并按 Enter 重新计算
    const runBtn = page.locator('button.btn-primary', { hasText: '运行分析' });
    await runBtn.focus();
    await page.keyboard.press('Enter');
    await expect(readyBadge).toBeVisible();
    // 计算完成后恢复为可导出状态
    await expect(page.locator('[data-testid="export-json-button"]')).toBeEnabled();

    // 验证 ARIA live 状态区存在且有 status 语义
    const statusBanner = page.locator('.status-banner-panel[role="status"][aria-live="polite"]');
    await expect(statusBanner).toBeVisible();
  });

  // =========================================================================
  // 5. 响应式布局与截图 (U02, 1200px 与 768px)
  // =========================================================================
  test('5. 响应式测试：1200px 桌面与 768px 平板不丢文字与主要操作，保存对应截图', async ({ page }) => {
    // 5.1 1200px 宽度桌面测试
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');
    const readyBadge = page.locator('.status-badge.status-ready');
    await expect(readyBadge).toBeVisible({ timeout: 10000 });

    // 断言 1200px 下导航、核心区域与主要操作均完整可见，不丢文字与操作
    await expect(page.locator('.top-header')).toBeVisible();
    await expect(page.locator('.preset-bar-panel')).toBeVisible();
    await expect(page.locator('.status-banner-panel')).toBeVisible();
    await expect(page.locator('.editor-card')).toBeVisible();
    await expect(page.locator('[data-testid="timerail-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="witness-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="audit-table-panel"]')).toBeVisible();

    // 截图保存 1200px
    await page.screenshot({ path: path.resolve(SCREENSHOTS_DIR, 'timefold-1200px-TF-B.png'), fullPage: true });
    await page.screenshot({ path: path.resolve(DEMO_DIR, '09-responsive-1200px.png'), fullPage: true });

    // 5.2 768px 宽度平板/移动堆叠测试
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await expect(readyBadge).toBeVisible({ timeout: 10000 });

    // 核心区域均依然可见并正常工作 (响应式单列堆叠)
    await expect(page.locator('.top-header')).toBeVisible();
    await expect(page.locator('.preset-bar-panel')).toBeVisible();
    await expect(page.locator('.status-banner-panel')).toBeVisible();
    await expect(page.locator('.editor-card')).toBeVisible();
    await expect(page.locator('[data-testid="timerail-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="witness-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="audit-table-panel"]')).toBeVisible();

    // 截图保存 768px
    await page.screenshot({ path: path.resolve(SCREENSHOTS_DIR, 'timefold-768px-TF-B.png'), fullPage: true });
    await page.screenshot({ path: path.resolve(DEMO_DIR, '10-responsive-768px.png'), fullPage: true });
  });

  // =========================================================================
  // 6. 2 分钟用户演示主路径与全流程截图 (U01, Demo Tour)
  // =========================================================================
  test('6. 两分钟演示主路径：TF-B -> 策略切换 -> TF-F -> 导入导出往返 -> 证据复制', async ({ page }) => {
    const tourStartTime = Date.now();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const readyBadge = page.locator('.status-badge.status-ready');
    await expect(readyBadge).toBeVisible({ timeout: 10000 });

    // 步骤 1：打开应用载入 TF-B (首屏截图)
    await page.screenshot({ path: path.resolve(DEMO_DIR, '01-initial-TF-B.png'), fullPage: true });

    // 步骤 2：切换 foldPolicy 策略
    // 2a. 切 earlier
    await page.locator('label', { hasText: '较早 (earlier)' }).click();
    await page.locator('button.btn-primary', { hasText: '运行分析' }).click();
    await expect(readyBadge).toBeVisible();
    await expect(page.locator('[data-testid="audit-selected-0"]')).toHaveText('2026-11-01T05:30:00Z');
    await page.screenshot({ path: path.resolve(DEMO_DIR, '02-fold-policy-earlier.png'), fullPage: true });

    // 2b. 切 later
    await page.locator('label', { hasText: '较晚 (later)' }).click();
    await page.locator('button.btn-primary', { hasText: '运行分析' }).click();
    await expect(readyBadge).toBeVisible();
    await expect(page.locator('[data-testid="audit-selected-0"]')).toHaveText('2026-11-01T06:30:00Z');
    await page.screenshot({ path: path.resolve(DEMO_DIR, '03-fold-policy-later.png'), fullPage: true });

    // 2c. 切 both
    await page.locator('label', { hasText: '并列 (both)' }).click();
    await page.locator('button.btn-primary', { hasText: '运行分析' }).click();
    await expect(readyBadge).toBeVisible();
    await expect(page.locator('[data-testid="audit-selected-0"]')).toContainText('2026-11-01T05:30:00Z, 2026-11-01T06:30:00Z');
    await page.screenshot({ path: path.resolve(DEMO_DIR, '04-fold-policy-both.png'), fullPage: true });

    // 步骤 3：切 TF-F 查看 weekly 漂移见证
    await page.locator('.preset-button', { hasText: 'TF-F' }).click();
    await expect(readyBadge).toBeVisible();
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('DRIFT');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('2026-03-09');
    await expect(page.locator('[data-testid="witness-panel"]')).toContainText('+60 min');
    await page.screenshot({ path: path.resolve(DEMO_DIR, '05-switch-to-TF-F.png'), fullPage: true });

    // 步骤 4：切 TF-A 并测试 gapPolicy shiftForward
    await page.locator('.preset-button', { hasText: 'TF-A' }).click();
    await expect(readyBadge).toBeVisible();
    await page.locator('label', { hasText: '顺移 (shiftForward)' }).click();
    await page.locator('button.btn-primary', { hasText: '运行分析' }).click();
    await expect(readyBadge).toBeVisible();
    await expect(page.locator('[data-testid="audit-selected-0"]')).toContainText('2026-03-08T07:00:00Z');
    await page.screenshot({ path: path.resolve(DEMO_DIR, '06-gap-shiftforward.png'), fullPage: true });

    // 步骤 5：JSON 导出与导入往返验证
    // 先切回 TF-B 准备导出
    await page.locator('.preset-button', { hasText: 'TF-B' }).click();
    await expect(readyBadge).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid="export-json-button"]').click(),
    ]);
    const downloadedFilePath = path.resolve(TMP_DIR, download.suggestedFilename());
    await download.saveAs(downloadedFilePath);

    const exportedContent = fs.readFileSync(downloadedFilePath, 'utf-8');
    const parsedExport = JSON.parse(exportedContent);
    expect(parsedExport.schema).toBe('timefold.export/1');
    expect(parsedExport.input.name).toBe('TF-B New York Fall Fold');

    // 临时切至 TF-E 改变当前状态
    await page.locator('.preset-button', { hasText: 'TF-E' }).click();
    await expect(readyBadge).toBeVisible();
    await expect(page.locator('.preset-button.active')).toContainText('TF-E');

    // 重新导入刚才导出的 TF-B JSON
    await page.locator('[data-testid="import-json-file-input"]').setInputFiles(downloadedFilePath);
    await expect(readyBadge).toBeVisible();

    // 校验导入后成功恢复 TF-B 数据
    await expect(page.locator('[data-testid="audit-requested-0"]')).toHaveText('2026-11-01 01:30');
    await expect(page.locator('[data-testid="status-badge-fold"]')).toBeVisible();
    await page.screenshot({ path: path.resolve(DEMO_DIR, '07-json-roundtrip.png'), fullPage: true });

    // 步骤 6：复制证据与见证定位
    const copyBtn = page.locator('[data-testid="copy-evidence-btn"]');
    await copyBtn.click();
    await expect(copyBtn).toContainText('已复制');
    await page.screenshot({ path: path.resolve(DEMO_DIR, '08-witness-evidence.png'), fullPage: true });

    // 断言整个主路径耗时严格在 120 秒目标内
    const tourDurationMs = Date.now() - tourStartTime;
    expect(tourDurationMs).toBeLessThan(120000);
  });

  // =========================================================================
  // 7. 90 次请求性能基准统计 (FR12, 90-Request Benchmark)
  // =========================================================================
  test('7. 性能基准：90 次请求日程分析 Worker 耗时统计 (中位/均值/P95 统计，指标 ≤2.0s)', async ({ page }) => {
    await page.goto('/');
    const readyBadge = page.locator('.status-badge.status-ready');
    await expect(readyBadge).toBeVisible({ timeout: 10000 });

    // 配置 90 个请求日期：2026-03-01 至 2026-05-29 (31 + 30 + 29 = 90 天)
    // 切换到 daily 频次
    await page.locator('label', { hasText: '每日 (daily)' }).click();
    await page.fill('#editor-start-date', '2026-03-01');
    await page.fill('#editor-end-date', '2026-05-29');

    // 首次触发计算
    await page.locator('button.btn-primary', { hasText: '运行分析' }).click();
    await expect(readyBadge).toBeVisible();

    // 断言确切生成了 90 个请求
    await expect(page.locator('[data-testid="audit-request-count"]')).toHaveText('90');

    // 执行 15 次独立计算采样，记录从点击到 READY 的真实耗时
    const sampleCount = 15;
    const durationsMs: number[] = [];

    for (let i = 0; i < sampleCount; i++) {
      // 切换策略标记为 DIRTY
      const targetFoldText = i % 2 === 0 ? '较早 (earlier)' : '并列 (both)';
      await page.locator('label', { hasText: targetFoldText }).click();

      // 点击计算并计时
      const startTime = await page.evaluate(() => performance.now());
      await page.locator('button.btn-primary', { hasText: '运行分析' }).click();
      await expect(readyBadge).toBeVisible();
      const endTime = await page.evaluate(() => performance.now());

      const elapsed = Math.round((endTime - startTime) * 100) / 100;
      durationsMs.push(elapsed);
    }

    // 计算统计指标
    const sorted: number[] = [...durationsMs].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const mean: number = Math.round((sum / sorted.length) * 100) / 100;
    const mid = Math.floor(sorted.length / 2);
    const midVal: number = sorted[mid] ?? 0;
    const midPrev: number = sorted[mid - 1] ?? 0;
    const median: number = sorted.length % 2 !== 0 ? midVal : Math.round(((midPrev + midVal) / 2) * 100) / 100;
    const min: number = sorted[0] ?? 0;
    const max: number = sorted[sorted.length - 1] ?? 0;
    const p95Index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
    const p95: number = sorted[p95Index] ?? 0;
    const variance = sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / sorted.length;
    const stdDev: number = Math.round(Math.sqrt(variance) * 100) / 100;

    // 收集硬件与环境指标
    const cpus = os.cpus();
    const perfData = {
      timestamp: new Date().toISOString(),
      benchmark: '90_request_dates_worker_analyze',
      methodology: '从点击"运行分析"到状态横幅变为READY的完整端到端耗时 (包含主线程派发、Dedicated Worker 同步 analyze、Web Crypto SHA-256 计算及主线程状态渲染)。通过交替变更折返策略触发 DIRTY 状态后重新计算，连续采样 15 次，计算中位数、平均值、最小值、最大值与 P95。',
      environment: {
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        cpuModel: cpus[0]?.model || 'Unknown CPU',
        cpuCores: cpus.length,
        totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
        freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
        nodeVersion: process.version,
      },
      schedule: {
        frequency: 'daily',
        zone: 'America/New_York',
        startDate: '2026-03-01',
        endDate: '2026-05-29',
        requestDatesCount: 90,
      },
      statistics: {
        samples: durationsMs,
        sampleCount,
        meanMs: mean,
        medianMs: median,
        minMs: min,
        maxMs: max,
        p95Ms: p95,
        stdDevMs: stdDev,
        thresholdTargetMs: 2000,
        verdict: median <= 2000 ? 'PASS' : 'FAIL',
      },
    };

    // 写入性能统计文件
    const perfReportPath = path.resolve(TESTS_EVIDENCE_DIR, 'T016-perf.json');
    fs.writeFileSync(perfReportPath, JSON.stringify(perfData, null, 2), 'utf-8');

    // 控制台输出完整统计摘要表
    console.log('\n================== 90 次请求性能基准统计 (FR12) ==================');
    console.log(`硬件环境: ${perfData.environment.cpuModel} (${perfData.environment.cpuCores} 核), ${perfData.environment.totalMemoryMb} MB RAM`);
    console.log(`执行环境: Node ${perfData.environment.nodeVersion}, OS ${perfData.environment.platform} ${perfData.environment.arch}`);
    console.log(`排程配置: 2026-03-01 至 2026-05-29 (每日排程，恰好 90 个请求日期)`);
    console.log(`采样样本 (${sampleCount} 次): [${durationsMs.join(', ')}] ms`);
    console.log(`中位数 (Median): ${median} ms (目标: ≤ 2000 ms) -> ${perfData.statistics.verdict}`);
    console.log(`平均值 (Mean):   ${mean} ms`);
    console.log(`最小值 (Min):    ${min} ms`);
    console.log(`最大值 (Max):    ${max} ms`);
    console.log(`95分位 (P95):    ${p95} ms`);
    console.log(`标准差 (StdDev): ${stdDev} ms`);
    console.log('===================================================================\n');

    // 断言性能符合规格目标：中位数 ≤ 2000 ms
    expect(median).toBeLessThanOrEqual(2000);
    // 同时也禁止仅依靠最快一次，断言 P95 同样稳定
    expect(p95).toBeLessThanOrEqual(2500);
  });
});
