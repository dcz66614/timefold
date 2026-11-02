/**
 * P009 时隙镜 TimeFold — 见证卡与逐实例审计表组件测试
 *
 * 严格遵从 PROJECT_BOOK.md §4.2, §4.3, §5.3, §9 FR07, FR08, FR09, U08 与 IMPLEMENTATION_PLAN.md §5 T013、TASK-P009-T013。
 *
 * 核心断言：
 * 1. TF-F: 首个见证显示 2026-03-09，偏差 +60min (DRIFT)。
 * 2. TF-E: 正常情况 NONE 绝不显示假风险，显示无异常/平稳正常。
 * 3. TF-A: 见证卡显示 GAP，跳时日 2026-03-08，分段跃迁边界 2026-03-08T07:00:00Z，0 候选。
 * 4. TF-B: 见证卡显示 FOLD，折返日 2026-11-01，两个候选 UTC (05:30Z 与 06:30Z)。
 * 5. 复制文本样本：严格包含 snapshot label、请求、候选、策略、首个见证与相关 UTC 偏移。
 * 6. 逐实例表：每行含请求日、状态、0/1/2 候选、选中值、基线、偏差。
 * 7. 联动与定位接口：提供 onLocateDate、onSelectIndex、onSelectRow 回调，支持点击与数据联动。
 * 8. 键盘可达性：表格与操作按钮具备 tabIndex={0} 和语义化 role。
 * 9. 文案约束：必须说明“仅供教学/开发测试、不适用于生产决策”，包含 SYNTHETIC 与快照版本。
 * 10. 前车之鉴兼容性：兼容传入 AnalysisComputation (无 digest 字段) 场景，保证不抛错。
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

import {
  WitnessPanel,
  formatDriftMinutes,
  formatHumanReadableEvidence,
} from '../../src/ui/WitnessPanel';
import { AuditTable } from '../../src/ui/AuditTable';
import { analyze } from '../../src/core/analyze';
import {
  PRESET_TF_A,
  PRESET_TF_B,
  PRESET_TF_E,
  PRESET_TF_F,
} from '../../src/data/presets';
import type { AnalysisComputation, Mapping } from '../../src/core/types';

describe('P009-T013 WitnessPanel & AuditTable 见证与审计组件测试', () => {
  describe('1. TF-F 黄金用例：固定周期间隔漂移见证断言', () => {
    it('断言 TF-F 显示 firstWitness 2026-03-09 +60min (DRIFT) 与跃迁边界', () => {
      const computation = analyze(PRESET_TF_F);
      expect(computation.firstWitness.type).toBe('DRIFT');
      expect(computation.firstWitness.date).toBe('2026-03-09');
      expect(computation.firstWitness.boundaryUtc).toBe('2026-03-08T07:00:00Z');
      expect(computation.firstWitness.mapping?.driftMinutes).toBe(60);

      const html = renderToString(
        <WitnessPanel
          result={computation}
          input={PRESET_TF_F}
          onLocateDate={() => {}}
        />
      );

      // 1. 见证卡核心数据断言
      expect(html).toContain('DRIFT · 基线漂移');
      expect(html).toContain('2026-03-09');
      expect(html).toContain('+60 min');
      expect(html).toContain('2026-03-08T07:00:00Z');
      expect(html).toContain('2026-03-09 09:00');
      expect(html).toContain('2026-03-09T13:00:00Z');
      expect(html).toContain('2026-03-09T14:00:00Z');

      // 2. 界面定位按钮与复制按钮存在
      expect(html).toContain('在表中定位');
      expect(html).toContain('复制完整证据文本');

      // 3. 严格文案断言：不适用于生产决策
      expect(html).toContain('不适用于生产决策');
      expect(html).toContain('SYNTHETIC');
    });

    it('断言 TF-F 在 AuditTable 中第 2 行标记首个见证，呈现 13:00Z 与 14:00Z 对照及 +60 min', () => {
      const computation = analyze(PRESET_TF_F);
      const html = renderToString(
        <AuditTable
          result={computation}
          firstWitnessDate={computation.firstWitness.date}
        />
      );

      // 1. 请求数与选中数
      expect(html).toContain('data-testid="audit-request-count"');
      expect(html).toContain('>4<');
      expect(html).toContain('data-testid="audit-selected-count"');

      // 2. 第 2 行 (index 1) 对应 2026-03-09 09:00
      expect(html).toContain('2026-03-09 09:00');
      expect(html).toContain('2026-03-09T13:00:00Z');
      expect(html).toContain('2026-03-09T14:00:00Z');
      expect(html).toContain('+60 min');
      expect(html).toContain('★ 首个见证');

      // 3. 首行 2026-03-02 正常对齐 (0 min)
      expect(html).toContain('2026-03-02 09:00');
      expect(html).toContain('0 min');
    });
  });

  describe('2. TF-E 黄金用例：正常情况 NONE 不显示假风险断言', () => {
    it('断言 TF-E 在 WitnessPanel 显示 NONE 平稳映射，绝不显示假风险警告', () => {
      const computation = analyze(PRESET_TF_E);
      expect(computation.firstWitness.type).toBe('NONE');
      expect(computation.firstWitness.date).toBeNull();
      expect(computation.firstWitness.boundaryUtc).toBeNull();

      const html = renderToString(
        <WitnessPanel result={computation} input={PRESET_TF_E} />
      );

      // 1. 显示平稳状态徽章与正面说明
      expect(html).toContain('NONE · 无异常平稳');
      expect(html).toContain('映射平稳 — 未发现异常风险');
      expect(html).toContain(computation.firstWitness.message);

      // 2. 严格排除假风险关键词
      expect(html).not.toContain('DRIFT · 基线漂移');
      expect(html).not.toContain('GAP · 跳时空洞');
      expect(html).not.toContain('FOLD · 折返分岔');
      expect(html).not.toContain('严重错误');
      expect(html).not.toContain('系统故障');
    });

    it('断言 TF-E 在 AuditTable 中全部呈现 NORMAL 状态且无首个见证异常标记', () => {
      const computation = analyze(PRESET_TF_E);
      const html = renderToString(<AuditTable result={computation} />);

      // 全部为 NORMAL 正常
      expect(html).toContain('NORMAL 正常');
      expect(html).not.toContain('★ 首个见证');
      expect(html).not.toContain('GAP 缺失');
      expect(html).not.toContain('FOLD 折返');
    });
  });

  describe('3. TF-A 黄金用例：春季跳时空洞 GAP 见证断言', () => {
    it('断言 TF-A 见证卡显示 GAP、跳时日 2026-03-08、分段边界 2026-03-08T07:00:00Z、0 候选', () => {
      const computation = analyze(PRESET_TF_A);
      expect(computation.firstWitness.type).toBe('GAP');
      expect(computation.firstWitness.date).toBe('2026-03-08');
      expect(computation.firstWitness.boundaryUtc).toBe('2026-03-08T07:00:00Z');

      const html = renderToString(
        <WitnessPanel result={computation} input={PRESET_TF_A} />
      );

      expect(html).toContain('GAP · 跳时空洞');
      expect(html).toContain('2026-03-08');
      expect(html).toContain('2026-03-08T07:00:00Z');
      expect(html).toContain('0 个候选');
      expect(html).toContain('0 候选 (跳时缺失时刻)');
    });

    it('断言 TF-A 在 AuditTable 中呈现 GAP 状态与 0 候选说明', () => {
      const computation = analyze(PRESET_TF_A);
      const html = renderToString(<AuditTable result={computation} />);

      expect(html).toContain('GAP 缺失');
      expect(html).toContain('0 候选 (跳时空洞)');
      expect(html).toContain('跳过 (无选中值)');
    });
  });

  describe('4. TF-B 黄金用例：秋季折返分岔 FOLD 见证断言', () => {
    it('断言 TF-B 见证卡显示 FOLD、折返日 2026-11-01、双候选 05:30Z 与 06:30Z', () => {
      const computation = analyze(PRESET_TF_B);
      expect(computation.firstWitness.type).toBe('FOLD');
      expect(computation.firstWitness.date).toBe('2026-11-01');

      const html = renderToString(
        <WitnessPanel result={computation} input={PRESET_TF_B} />
      );

      expect(html).toContain('FOLD · 折返分岔');
      expect(html).toContain('2026-11-01');
      expect(html).toContain('2026-11-01T06:00:00Z');
      expect(html).toContain('2 个候选');
      expect(html).toContain('2026-11-01T05:30:00Z, 2026-11-01T06:30:00Z');
    });

    it('断言 TF-B 在 AuditTable 中展示 [2 候选] 及选中的两个时刻', () => {
      const computation = analyze(PRESET_TF_B);
      const html = renderToString(<AuditTable result={computation} />);

      expect(html).toContain('FOLD 折返');
      expect(html).toMatch(/2.*候选/);
      expect(html).toContain('2026-11-01T05:30:00Z, 2026-11-01T06:30:00Z');
    });
  });

  describe('5. 可复制人类可读证据文本生成断言 (formatHumanReadableEvidence)', () => {
    it('断言 TF-F 证据文本严格包含 snapshot label、请求、候选、策略、首个见证与相关 UTC 偏移', () => {
      const computation = analyze(PRESET_TF_F);
      const evidenceText = formatHumanReadableEvidence({
        input: PRESET_TF_F,
        witness: computation.firstWitness,
        digest: 'fake-test-digest-sha256',
      });

      // 1. snapshot label
      expect(evidenceText).toContain('America/New_York (frozen-2026)');

      // 2. 请求本地时间
      expect(evidenceText).toContain('2026-03-09 09:00');

      // 3. 候选 UTC
      expect(evidenceText).toContain('2026-03-09T13:00:00Z');

      // 4. 策略
      expect(evidenceText).toContain('frequency=weekly');
      expect(evidenceText).toContain('gapPolicy=skip');
      expect(evidenceText).toContain('foldPolicy=earlier');

      // 5. 首个见证
      expect(evidenceText).toContain('见证类型】: DRIFT');
      expect(evidenceText).toContain('见证日期】: 2026-03-09');
      expect(evidenceText).toContain('分段边界】: 2026-03-08T07:00:00Z');

      // 6. 相关 UTC 偏移
      expect(evidenceText).toContain('基线偏差】: +60 min');
      expect(evidenceText).toContain('基线对照】: 2026-03-09T14:00:00Z');

      // 7. 免责声明与数据标识
      expect(evidenceText).toContain('仅供教学/开发测试，不适用于生产决策');
      expect(evidenceText).toContain('SYNTHETIC / 2026 FROZEN TZ SNAPSHOT / OFFLINE');
      expect(evidenceText).toContain('fake-test-digest-sha256');
    });

    it('断言 formatDriftMinutes 规范格式化输出', () => {
      expect(formatDriftMinutes(60)).toBe('+60 min');
      expect(formatDriftMinutes(-60)).toBe('-60 min');
      expect(formatDriftMinutes(0)).toBe('0 min');
      expect(formatDriftMinutes(null)).toBe('N/A');
      expect(formatDriftMinutes(undefined)).toBe('N/A');
    });
  });

  describe('6. 交互与可访问性断言', () => {
    it('断言 AuditTable 支持键盘聚焦与 role 语义', () => {
      const computation = analyze(PRESET_TF_A);
      const html = renderToString(<AuditTable result={computation} />);

      expect(html).toContain('role="table"');
      expect(html).toContain('role="row"');
      expect(html).toContain('tabindex="0"');
    });

    it('断言 WitnessPanel 在存在定位回调时生成定位按钮', () => {
      const computation = analyze(PRESET_TF_F);
      const html = renderToString(
        <WitnessPanel
          result={computation}
          input={PRESET_TF_F}
          onLocateDate={() => {}}
        />
      );

      expect(html).toContain('data-testid="locate-witness-date-btn"');
      expect(html).toContain('在表中定位 ↗');
    });

    it('断言 AuditTable 选中行高亮样式类与 aria-selected', () => {
      const computation = analyze(PRESET_TF_F);
      const html = renderToString(
        <AuditTable result={computation} selectedIndex={1} />
      );

      expect(html).toContain('aria-selected="true"');
      expect(html).toContain('row-selected');
    });
  });

  describe('7. 前车之鉴与兼容性验证', () => {
    it('兼容直接传入纯计算 AnalysisComputation (无 digest 字段)', () => {
      const pureComputation: AnalysisComputation = analyze(PRESET_TF_B);
      // 确认类型与运行期没有 digest 也不崩溃
      expect('digest' in pureComputation).toBe(false);

      const witnessHtml = renderToString(
        <WitnessPanel result={pureComputation} input={PRESET_TF_B} />
      );
      expect(witnessHtml).toContain('FOLD · 折返分岔');

      const auditHtml = renderToString(
        <AuditTable result={pureComputation} />
      );
      expect(auditHtml).toContain('纯计算 (待封包)');
    });

    it('兼容空数据与初始未计算状态渲染', () => {
      const witnessHtml = renderToString(<WitnessPanel result={null} />);
      expect(witnessHtml).toContain('WITNESS STANDBY');

      const auditHtml = renderToString(<AuditTable occurrences={[]} />);
      expect(auditHtml).toContain('当前没有映射实例数据');
    });
  });
});
