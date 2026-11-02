/**
 * P009 时隙镜 TimeFold — UI 框架与核心组件单元测试
 * 严格遵从 PROJECT_BOOK.md §4.2, §4.3 与 IMPLEMENTATION_PLAN.md §5 T011。
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';

import { App } from '../../src/ui/App';
import { PresetBar } from '../../src/ui/PresetBar';
import { StatusBanner } from '../../src/ui/StatusBanner';
import { ScheduleEditor } from '../../src/ui/ScheduleEditor';
import { clonePresetInput } from '../../src/data/presets';

describe('P009-T011 UI 框架与组件测试', () => {
  describe('StatusBanner 组件测试', () => {
    it('正确渲染 READY 状态与语义说明', () => {
      const html = renderToString(<StatusBanner status="READY" />);
      expect(html).toContain('READY');
      expect(html).toContain('当前状态已就绪');
      expect(html).toContain('status-ready');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
    });

    it('正确渲染 DIRTY 状态', () => {
      const html = renderToString(
        <StatusBanner status="DIRTY" statusMessage="输入变化，结果已过期" />
      );
      expect(html).toContain('DIRTY');
      expect(html).toContain('输入变化，结果已过期');
      expect(html).toContain('status-dirty');
    });

    it('正确渲染 CALCULATING 状态', () => {
      const html = renderToString(<StatusBanner status="CALCULATING" />);
      expect(html).toContain('CALCULATING');
      expect(html).toContain('status-calculating');
    });

    it('正确渲染 ERROR 状态与字段路径', () => {
      const html = renderToString(
        <StatusBanner
          status="ERROR"
          error={{
            code: 'E_INVALID_LOCAL_TIME',
            path: 'schedule.localTime',
            message: 'Invalid time format',
          }}
        />
      );
      expect(html).toContain('ERROR');
      expect(html).toContain('E_INVALID_LOCAL_TIME');
      expect(html).toContain('schedule.localTime');
      expect(html).toContain('Invalid time format');
      expect(html).toContain('status-error');
    });

    it('必须同时包含 SELECTED, FOLD, GAP, DRIFT 4种图例与文字说明（不可仅靠颜色）', () => {
      const html = renderToString(<StatusBanner status="READY" />);
      expect(html).toContain('SELECTED');
      expect(html).toContain('有效实例');
      expect(html).toContain('FOLD');
      expect(html).toContain('折返候选');
      expect(html).toContain('GAP');
      expect(html).toContain('跳时缺口');
      expect(html).toContain('DRIFT');
      expect(html).toContain('基线漂移');
    });

    it('当提供 counts 时，图例精确区分“选中 UTC 实例数”与“请求日期数”', () => {
      const html = renderToString(
        <StatusBanner
          status="READY"
          counts={{
            selected: 2,
            requestCount: 1,
            fold: 2,
          }}
        />
      );
      expect(html).toContain('选中 UTC 实例数: 2');
      expect(html).toContain('请求日期数: 1');
      expect(html).toContain('有效实例');
    });
  });

  describe('PresetBar 组件测试', () => {
    it('正确渲染全部 6 个预设按钮 (TF-A 至 TF-F) 并高亮激活预设', () => {
      const onSelect = vi.fn();
      const html = renderToString(
        <PresetBar activePresetId="TF-B" onSelectPreset={onSelect} />
      );

      expect(html).toContain('TF-A');
      expect(html).toContain('TF-B');
      expect(html).toContain('TF-C');
      expect(html).toContain('TF-D');
      expect(html).toContain('TF-E');
      expect(html).toContain('TF-F');

      // TF-B 应高亮
      expect(html).toContain('preset-button active');
      expect(html).toContain('aria-pressed="true"');
      // 包含映射机制说明
      expect(html).toContain('0/1/2 UTC 映射机制');
    });
  });

  describe('ScheduleEditor 组件测试', () => {
    it('正确渲染 2026 冻结时区、时间、频次、策略单选与操作按钮', () => {
      const input = clonePresetInput('TF-B');
      const html = renderToString(
        <ScheduleEditor
          input={input}
          onChange={vi.fn()}
          onRun={vi.fn()}
          onReset={vi.fn()}
          onImport={vi.fn()}
        />
      );

      // 时区
      expect(html).toContain('America/New_York');
      expect(html).toContain('Europe/London');
      expect(html).toContain('Asia/Tokyo');
      // 本地时间
      expect(html).toContain('value="01:30"');
      // 频次
      expect(html).toContain('once');
      expect(html).toContain('daily');
      expect(html).toContain('weekly');
      // 策略选项
      expect(html).toContain('skip');
      expect(html).toContain('shiftForward');
      expect(html).toContain('earlier');
      expect(html).toContain('later');
      expect(html).toContain('both');
      // 按钮
      expect(html).toContain('运行分析');
      expect(html).toContain('重置');
      expect(html).toContain('导入 JSON');
    });

    it('当频次为 weekly 时正确渲染星期多选按钮', () => {
      const input = clonePresetInput('TF-F'); // TF-F is weekly
      const html = renderToString(
        <ScheduleEditor
          input={input}
          onChange={vi.fn()}
          onRun={vi.fn()}
          onReset={vi.fn()}
          onImport={vi.fn()}
        />
      );
      expect(html).toContain('byWeekday 1..7');
      expect(html).toContain('星期一');
    });
  });

  describe('App 完整骨架测试', () => {
    it('顶栏包含 TIMEFOLD, P009, 2026 SNAPSHOT, SYNTHETIC, OFFLINE 标识与导出按钮', () => {
      const html = renderToString(<App />);
      expect(html).toContain('TIMEFOLD');
      expect(html).toContain('P009');
      expect(html).toContain('2026 SNAPSHOT');
      expect(html).toContain('SYNTHETIC');
      expect(html).toContain('OFFLINE');
      expect(html).toContain('导出 JSON');
    });

    it('页面骨架包含左输入区、中时间轴占位、右见证占位与底审计表占位', () => {
      const html = renderToString(<App />);
      // 左
      expect(html).toContain('输入与政策参数');
      // 中
      expect(html).toContain('TimeRail 占位');
      expect(html).toContain('T012 施工挂载');
      // 右
      expect(html).toContain('WitnessPanel 占位');
      expect(html).toContain('T013 施工挂载');
      // 底
      expect(html).toContain('AuditTable 占位');
    });

    it('默认载入 TF-B 预设', () => {
      const html = renderToString(<App />);
      expect(html).toContain('TF-B');
      expect(html).toContain('Fall Fold');
    });

    it('所有可交互元素均具备 Tab 焦点与无障碍属性', () => {
      const html = renderToString(<App />);
      // 顶栏导出按钮
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('aria-label="导出当前分析配置为 JSON 文件"');
      // 预设选择
      expect(html).toContain('aria-label="时隙镜预设场景选择"');
      // 状态区
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('role="status"');
      // 策略单选
      expect(html).toContain('role="radiogroup"');
    });
  });

  describe('CSS 样式与响应式断点规范测试 (§4.3)', () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const cssPath = path.resolve(__dirname, '../../src/ui/styles.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    it('必须定义深色海军蓝底与三色语义色彩变量', () => {
      expect(cssContent).toContain('--color-bg-base: #060b19');
      expect(cssContent).toContain('--color-teal: #10b981');
      expect(cssContent).toContain('--color-amber: #f59e0b');
      expect(cssContent).toContain('--color-coral: #f43f5e');
    });

    it('必须定义桌面推荐 1200px 宽度容器约束', () => {
      expect(cssContent).toContain('max-width: 1200px');
    });

    it('必须定义 <900px 移动端单列上下堆叠媒体查询', () => {
      expect(cssContent).toContain('@media (max-width: 899px)');
      expect(cssContent).toContain('grid-template-columns: 1fr');
    });

    it('必须支持 prefers-reduced-motion 减少动效模式', () => {
      expect(cssContent).toContain('@media (prefers-reduced-motion: reduce)');
      expect(cssContent).toContain('animation-duration: 0.01ms !important');
    });

    it('必须为键盘访问提供高对比度 focus-visible 焦点轮廓', () => {
      expect(cssContent).toContain(':focus-visible');
      expect(cssContent).toContain('outline: 2px solid var(--color-border-focus)');
    });
  });
});
