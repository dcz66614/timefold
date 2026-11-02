/**
 * P009 时隙镜 TimeFold — 双轨时间轴可视化组件 (TimeRail) 单元测试
 *
 * 严格遵从 PROJECT_BOOK.md §4.3 与 IMPLEMENTATION_PLAN.md §5 T012、TASK-P009-T012。
 *
 * 核心断言：
 * 1. TF-A: 跳时日空洞 (gap-hole) DOM 数量为 1，包含 GAP 标签，无折返弧与漂移线。
 * 2. TF-B: 折返日双分支 (fold-branch) DOM 数量为 2，包含 FOLD 标签，无空洞与漂移线。
 * 3. TF-F: 分歧线 (drift-line) DOM 数量为 3，标签含 DRIFT +60 min，基准为 14:00Z。
 * 4. 坐标轴每刻度标注为 UTC 与 Local，具备明确轨头标识。
 * 5. 图例包含 SELECTED / FOLD / GAP / DRIFT 文字与符号，不用颜色做唯一信号。
 * 6. 纯数据驱动：空数据与自定义合成数据渲染，验证非写死预设。
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { TimeRail } from '../../src/ui/TimeRail';
import { analyze } from '../../src/core/analyze';
import { PRESET_TF_A, PRESET_TF_B, PRESET_TF_F } from '../../src/data/presets';
import type { Mapping } from '../../src/core/types';

/** 辅助函数：根据 data-testid 统计 DOM 数量 */
function countTestId(html: string, testId: string): number {
  const re = new RegExp(`data-testid="${testId}"`, 'g');
  const matches = html.match(re);
  return matches ? matches.length : 0;
}

/** 辅助函数：根据 className 统计 DOM 数量 */
function countClass(html: string, className: string): number {
  const re = new RegExp(`class="[^"]*\\b${className}\\b[^"]*"`, 'g');
  const matches = html.match(re);
  return matches ? matches.length : 0;
}

describe('P009-T012 TimeRail 双轨时间轴组件测试', () => {
  describe('1. TF-A 黄金用例：春季跳时日空洞与虚线断言', () => {
    it('断言 TF-A 空洞 DOM 数为 1，虚线数为 1，包含 GAP 标签，无折返与漂移线', () => {
      const result = analyze(PRESET_TF_A);
      expect(result.occurrences).toHaveLength(1);
      expect(result.occurrences[0]?.status).toBe('GAP');

      const html = renderToString(
        <TimeRail
          occurrences={result.occurrences}
          timeZoneLabel={PRESET_TF_A.zone.label}
        />
      );

      // 1. 空洞与虚线 DOM 数严格断言
      expect(countTestId(html, 'gap-hole')).toBe(1);
      expect(countClass(html, 'rail-gap-hole')).toBe(1);
      expect(countTestId(html, 'gap-dashed-line')).toBe(1);
      expect(countClass(html, 'rail-gap-dashed-line')).toBe(1);

      // 2. 标签与说明断言
      expect(countTestId(html, 'gap-badge')).toBe(1);
      expect(html).toContain('GAP');
      expect(html).toContain('跳时缺失时刻 (0 候选)');
      expect(html).toContain('策略: 跳过 (skip)');

      // 3. 严格排除折返与漂移线 DOM
      expect(countTestId(html, 'fold-branch')).toBe(0);
      expect(countTestId(html, 'drift-line')).toBe(0);

      // 4. 单次计划无基准断言
      expect(countTestId(html, 'baseline-na')).toBe(1);
      expect(html).toContain('单次计划无基准');
    });
  });

  describe('2. TF-B 黄金用例：秋季折返日双分支弧断言', () => {
    it('断言 TF-B 双分支 DOM 数为 2，包含 FOLD 标签与两个候选 UTC 时间，无空洞与漂移线', () => {
      const result = analyze(PRESET_TF_B);
      expect(result.occurrences).toHaveLength(1);
      expect(result.occurrences[0]?.status).toBe('FOLD');
      expect(result.occurrences[0]?.candidatesUtc).toHaveLength(2);

      const html = renderToString(
        <TimeRail
          occurrences={result.occurrences}
          timeZoneLabel={PRESET_TF_B.zone.label}
        />
      );

      // 1. 双分支弧线 DOM 数严格断言（2 个分支弧）
      expect(countTestId(html, 'fold-branch')).toBe(2);
      expect(countClass(html, 'rail-fold-branch')).toBe(2);
      expect(countClass(html, 'fold-branch-earlier')).toBe(1);
      expect(countClass(html, 'fold-branch-later')).toBe(1);

      // 2. 两个候选点 DOM 断言
      expect(countTestId(html, 'fold-candidate-1')).toBe(1);
      expect(countTestId(html, 'fold-candidate-2')).toBe(1);

      // 3. FOLD 标签与候选时间文字断言
      expect(countTestId(html, 'fold-badge')).toBe(1);
      expect(html).toContain('FOLD');
      expect(html).toContain('双分支折返');
      expect(html).toContain('05:30Z'); // 候选 1
      expect(html).toContain('06:30Z'); // 候选 2
      expect(html).toContain('2026-11-01T05:30:00Z'); // 底部完整绝对时间

      // 4. 严格排除空洞与漂移线 DOM
      expect(countTestId(html, 'gap-hole')).toBe(0);
      expect(countTestId(html, 'drift-line')).toBe(0);
      expect(countTestId(html, 'baseline-na')).toBe(1);
    });
  });

  describe('3. TF-F 黄金用例：固定间隔漂移分歧线断言', () => {
    it('断言 TF-F 产生 4 个时刻，其中 3 条分歧线（drift-line DOM 为 3），标签含 DRIFT +60 min', () => {
      const result = analyze(PRESET_TF_F);
      expect(result.occurrences).toHaveLength(4);

      const html = renderToString(
        <TimeRail
          occurrences={result.occurrences}
          timeZoneLabel={PRESET_TF_F.zone.label}
        />
      );

      // 1. TF-F 4 项中，第 0 项 drift=0，后 3 项 drift=60
      // 因此 drift-line 数量严格等于 3
      expect(countTestId(html, 'drift-line')).toBe(3);
      expect(countClass(html, 'rail-drift-line')).toBe(3);

      // 2. 漂移标签徽章与文字断言
      expect(countTestId(html, 'drift-badge')).toBe(3);
      expect(html).toContain('DRIFT +60 min');

      // 3. 0 min 吻合项断言
      expect(countTestId(html, 'match-line')).toBe(1);
      expect(html).toContain('0 min 偏差');

      // 4. 下轨基准节点断言（4 个基准点）
      expect(countTestId(html, 'baseline-node')).toBe(4);
      expect(html).toContain('UTC: 14:00Z');
      expect(html).toContain('固定基准 (1440m 步进)');

      // 5. 正常日单线与节点断言
      expect(countTestId(html, 'normal-line')).toBe(4);
      expect(countTestId(html, 'normal-node')).toBe(4);

      // 6. 排除空洞与折返分支
      expect(countTestId(html, 'gap-hole')).toBe(0);
      expect(countTestId(html, 'fold-branch')).toBe(0);
    });
  });

  describe('4. 坐标轴与刻度标注断言（双轨 Local / UTC 标识明确）', () => {
    it('坐标轴具备明确的双轨头标注与每列 Local / UTC 刻度', () => {
      const result = analyze(PRESET_TF_F);
      const html = renderToString(<TimeRail occurrences={result.occurrences} />);

      // 1. 上轨与下轨标识
      expect(html).toContain('① 墙上固定轨');
      expect(html).toContain('Local (当地时间)');
      expect(html).toContain('② UTC 间隔固定轨');
      expect(html).toContain('UTC (绝对时间)');

      // 2. 每列均含有双轨刻度指示
      expect(countClass(html, 'axis-tick-local')).toBe(4);
      expect(countClass(html, 'axis-tick-utc')).toBe(4);

      // 3. 底部详细数值包含 Local 与 UTC
      expect(html).toContain('Local: 2026-03-02 09:00');
      expect(html).toContain('UTC: 2026-03-02T14:00:00Z');
      expect(html).toContain('Local: 2026-03-09 09:00');
      expect(html).toContain('UTC: 2026-03-09T13:00:00Z');
    });

    it('顶部图例同时提供 SELECTED、FOLD、GAP、DRIFT 文字与形状符号', () => {
      const result = analyze(PRESET_TF_F);
      const html = renderToString(<TimeRail occurrences={result.occurrences} />);

      expect(countTestId(html, 'legend-selected')).toBe(1);
      expect(html).toContain('SELECTED');
      expect(html).toContain('有效实例');

      expect(countTestId(html, 'legend-fold')).toBe(1);
      expect(html).toContain('FOLD');
      expect(html).toContain('折返双分支');

      expect(countTestId(html, 'legend-gap')).toBe(1);
      expect(html).toContain('GAP');
      expect(html).toContain('跳时空洞虚线');

      expect(countTestId(html, 'legend-drift')).toBe(1);
      expect(html).toContain('DRIFT');
      expect(html).toContain('间隔漂移连线');
    });
  });

  describe('5. 纯数据驱动与非预设硬编码验证', () => {
    it('当传入空数组时正确渲染空状态且不崩溃', () => {
      const html = renderToString(<TimeRail occurrences={[]} />);
      expect(html).toContain('暂无时间映射数据');
      expect(countTestId(html, 'gap-hole')).toBe(0);
      expect(countTestId(html, 'fold-branch')).toBe(0);
      expect(countTestId(html, 'drift-line')).toBe(0);
    });

    it('支持直接传入 result 对象或 mappings 别名', () => {
      const result = analyze(PRESET_TF_A);
      const htmlFromResult = renderToString(<TimeRail result={result} />);
      expect(countTestId(htmlFromResult, 'gap-hole')).toBe(1);

      const htmlFromMappings = renderToString(<TimeRail mappings={result.occurrences} />);
      expect(countTestId(htmlFromMappings, 'gap-hole')).toBe(1);
    });

    it('动态合成数据：多个折返日按数据渲染对应数量的双分支', () => {
      // 构造含有 2 个 FOLD 的纯合成数据
      const syntheticFoldMappings: Mapping[] = [
        {
          requestedLocal: '2026-10-25 01:30',
          status: 'FOLD',
          candidatesUtc: ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z'],
          selectedUtc: ['2026-10-25T00:30:00Z'],
          realizedLocal: ['2026-10-25 01:30'],
          baselineUtc: null,
          driftMinutes: null,
        },
        {
          requestedLocal: '2026-11-01 01:30',
          status: 'FOLD',
          candidatesUtc: ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'],
          selectedUtc: ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'],
          realizedLocal: ['2026-11-01 01:30', '2026-11-01 01:30'],
          baselineUtc: null,
          driftMinutes: null,
        },
      ];

      const html = renderToString(<TimeRail occurrences={syntheticFoldMappings} />);
      // 2 个 FOLD -> 每个 2 个分支弧 -> 共 4 条 fold-branch
      expect(countTestId(html, 'fold-branch')).toBe(4);
      expect(countTestId(html, 'fold-badge')).toBe(2);
    });

    it('动态合成数据：负向漂移 (-60 min) 正确渲染负偏差数值与分歧线', () => {
      const syntheticDriftMapping: Mapping[] = [
        {
          requestedLocal: '2026-11-02 09:00',
          status: 'NORMAL',
          candidatesUtc: ['2026-11-02T14:00:00Z'],
          selectedUtc: ['2026-11-02T14:00:00Z'],
          realizedLocal: ['2026-11-02 09:00'],
          baselineUtc: '2026-11-02T13:00:00Z',
          driftMinutes: -60,
        },
      ];

      const html = renderToString(<TimeRail occurrences={syntheticDriftMapping} />);
      expect(countTestId(html, 'drift-line')).toBe(1);
      expect(html).toContain('DRIFT -60 min');
      expect(html).toContain('差异: -60 min');
    });
  });

  describe('6. 交互与无障碍（ARIA / 键盘支持）', () => {
    it('每一列均具备键盘聚焦 tabindex="0"、role="button" 与语义 aria-label', () => {
      const result = analyze(PRESET_TF_A);
      const html = renderToString(<TimeRail occurrences={result.occurrences} />);

      expect(html).toContain('tabindex="0"');
      expect(html).toContain('role="button"');
      expect(html).toContain('aria-label="时间点 1: 当地 2026-03-08 02:30, 状态 GAP, 基线偏差 N/A"');
    });

    it('当指定 selectedIndex 时正确高亮对应列', () => {
      const result = analyze(PRESET_TF_F);
      const html = renderToString(
        <TimeRail occurrences={result.occurrences} selectedIndex={1} />
      );

      expect(html).toContain('timerail-column selected');
    });
  });
});
