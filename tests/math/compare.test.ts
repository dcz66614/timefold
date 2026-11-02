import { describe, expect, it } from 'vitest';
import {
  type TimeFoldInput,
  type SelectedMapping,
  buildComparison,
  findFirstWitness,
  analyze,
  diffDays,
  addDays,
  NEW_YORK_SEGMENTS,
  LONDON_SEGMENTS,
  TOKYO_SEGMENTS,
  UTC_SEGMENTS,
  TimeFoldError,
} from '../../src/core';

describe('P009-T007 对照与最早见证汇总测试', () => {
  describe('MATH08 黄金用例：TF-F 固定间隔漂移验证', () => {
    const tfFInput: TimeFoldInput = {
      schema: 'timefold.spec/1',
      name: 'TF-F Fixed Interval Drift',
      synthetic: true,
      zone: {
        label: 'America/New_York',
        snapshot: 'frozen-2026',
        segments: [...NEW_YORK_SEGMENTS],
      },
      schedule: {
        frequency: 'weekly',
        startDate: '2026-03-02',
        endDate: '2026-03-23',
        localTime: '09:00',
        byWeekday: [1], // 周一
      },
      policy: {
        gap: 'skip',
        fold: 'earlier',
      },
    };

    it('TF-F 产生正确的 4 个 UTC 实例、4 个 14:00Z 基线和 2026-03-09 +60 见证', () => {
      const result = analyze(tfFInput);

      // 打印逐日期 JSON 证据供日志审计
      console.log('=== TF-F 逐日期 JSON 汇总证据 ===');
      console.log(JSON.stringify(result, null, 2));

      expect(result.schema).toBe('timefold.result/1');
      expect(result.requestCount).toBe(4);
      expect(result.selectedCount).toBe(4);
      expect(result.occurrences).toHaveLength(4);

      const [occ0, occ1, occ2, occ3] = result.occurrences;

      // 1. 2026-03-02 (冬令时 EST -300min)
      expect(occ0?.requestedLocal).toBe('2026-03-02 09:00');
      expect(occ0?.status).toBe('NORMAL');
      expect(occ0?.selectedUtc).toEqual(['2026-03-02T14:00:00Z']);
      expect(occ0?.baselineUtc).toBe('2026-03-02T14:00:00Z');
      expect(occ0?.driftMinutes).toBe(0);

      // 2. 2026-03-09 (夏令时 EDT -240min，首次发生漂移)
      expect(occ1?.requestedLocal).toBe('2026-03-09 09:00');
      expect(occ1?.status).toBe('NORMAL');
      expect(occ1?.selectedUtc).toEqual(['2026-03-09T13:00:00Z']);
      expect(occ1?.baselineUtc).toBe('2026-03-09T14:00:00Z');
      expect(occ1?.driftMinutes).toBe(60); // +60 min

      // 3. 2026-03-16 (夏令时 EDT -240min)
      expect(occ2?.requestedLocal).toBe('2026-03-16 09:00');
      expect(occ2?.status).toBe('NORMAL');
      expect(occ2?.selectedUtc).toEqual(['2026-03-16T13:00:00Z']);
      expect(occ2?.baselineUtc).toBe('2026-03-16T14:00:00Z');
      expect(occ2?.driftMinutes).toBe(60);

      // 4. 2026-03-23 (夏令时 EDT -240min)
      expect(occ3?.requestedLocal).toBe('2026-03-23 09:00');
      expect(occ3?.status).toBe('NORMAL');
      expect(occ3?.selectedUtc).toEqual(['2026-03-23T13:00:00Z']);
      expect(occ3?.baselineUtc).toBe('2026-03-23T14:00:00Z');
      expect(occ3?.driftMinutes).toBe(60);

      // 黄金首个见证断言
      expect(result.firstWitness.type).toBe('DRIFT');
      expect(result.firstWitness.date).toBe('2026-03-09');
      expect(result.firstWitness.boundaryUtc).toBe('2026-03-08T07:00:00Z');
      expect(result.firstWitness.mapping?.driftMinutes).toBe(60);
      expect(result.firstWitness.message).toContain('2026-03-09');
      expect(result.firstWitness.message).toContain('+60 min');
    });
  });

  describe('once 模式与基线 N/A 验证', () => {
    it('once 模式下 baselineUtc 与 driftMinutes 必须为 null', () => {
      const tfBInput: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'TF-B New York Fall Fold',
        synthetic: true,
        zone: {
          label: 'America/New_York',
          snapshot: 'frozen-2026',
          segments: [...NEW_YORK_SEGMENTS],
        },
        schedule: {
          frequency: 'once',
          startDate: '2026-11-01',
          endDate: '2026-11-01',
          localTime: '01:30',
          byWeekday: [],
        },
        policy: {
          gap: 'skip',
          fold: 'both',
        },
      };

      const result = analyze(tfBInput);
      expect(result.requestCount).toBe(1);
      expect(result.selectedCount).toBe(2);
      expect(result.occurrences).toHaveLength(1);

      const row = result.occurrences[0]!;
      expect(row.status).toBe('FOLD');
      expect(row.candidatesUtc).toEqual([
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
      ]);
      expect(row.selectedUtc).toEqual([
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
      ]);
      expect(row.baselineUtc).toBeNull();
      expect(row.driftMinutes).toBeNull();

      expect(result.firstWitness.type).toBe('FOLD');
      expect(result.firstWitness.date).toBe('2026-11-01');
      expect(result.firstWitness.boundaryUtc).toBe('2026-11-01T06:00:00Z');
    });

    it('TF-A once gap skip 模式输出 selectedCount=0 且基线为 N/A', () => {
      const tfAInput: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'TF-A Spring Gap Skip',
        synthetic: true,
        zone: {
          label: 'America/New_York',
          snapshot: 'frozen-2026',
          segments: [...NEW_YORK_SEGMENTS],
        },
        schedule: {
          frequency: 'once',
          startDate: '2026-03-08',
          endDate: '2026-03-08',
          localTime: '02:30',
          byWeekday: [],
        },
        policy: {
          gap: 'skip',
          fold: 'earlier',
        },
      };

      const result = analyze(tfAInput);
      expect(result.requestCount).toBe(1);
      expect(result.selectedCount).toBe(0);
      expect(result.occurrences[0]!.status).toBe('GAP');
      expect(result.occurrences[0]!.selectedUtc).toEqual([]);
      expect(result.occurrences[0]!.baselineUtc).toBeNull();
      expect(result.occurrences[0]!.driftMinutes).toBeNull();

      expect(result.firstWitness.type).toBe('GAP');
      expect(result.firstWitness.date).toBe('2026-03-08');
      expect(result.firstWitness.boundaryUtc).toBe('2026-03-08T07:00:00Z');
    });
  });

  describe('无见证 NONE 验证', () => {
    it('TF-E 东京常态 daily 3 天无任何异常，返回 firstWitness=NONE', () => {
      const tfEInput: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'TF-E Tokyo Daily',
        synthetic: true,
        zone: {
          label: 'Asia/Tokyo',
          snapshot: 'frozen-2026',
          segments: [...TOKYO_SEGMENTS],
        },
        schedule: {
          frequency: 'daily',
          startDate: '2026-06-01',
          endDate: '2026-06-03',
          localTime: '09:00',
          byWeekday: [],
        },
        policy: {
          gap: 'skip',
          fold: 'earlier',
        },
      };

      const result = analyze(tfEInput);
      expect(result.requestCount).toBe(3);
      expect(result.selectedCount).toBe(3);
      expect(result.firstWitness.type).toBe('NONE');
      expect(result.firstWitness.date).toBeNull();
      expect(result.firstWitness.boundaryUtc).toBeNull();
      expect(result.firstWitness.mapping).toBeNull();

      for (const occ of result.occurrences) {
        expect(occ.status).toBe('NORMAL');
        expect(occ.driftMinutes).toBe(0);
      }
    });
  });

  describe('全部 skip 与首日 skip 边界情况', () => {
    it('若 daily 排程中全部被 skip，基线全部为 N/A', () => {
      const input: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'All Skipped Daily',
        synthetic: true,
        zone: {
          label: 'America/New_York',
          snapshot: 'frozen-2026',
          segments: [...NEW_YORK_SEGMENTS],
        },
        schedule: {
          frequency: 'daily',
          startDate: '2026-03-08',
          endDate: '2026-03-08',
          localTime: '02:30',
          byWeekday: [],
        },
        policy: {
          gap: 'skip',
          fold: 'earlier',
        },
      };

      const mockSelected: SelectedMapping[] = [
        {
          requestedLocal: '2026-03-08 02:30',
          status: 'GAP',
          candidatesUtc: [],
          selectedUtc: [],
          realizedLocal: [],
          gapBoundaryUtc: '2026-03-08T07:00:00Z',
        },
      ];

      const res = buildComparison(input, mockSelected);
      expect(res).toHaveLength(1);
      expect(res[0]!.baselineUtc).toBeNull();
      expect(res[0]!.driftMinutes).toBeNull();
    });

    it('首日 skip、次日有实例：anchor 从次日建立，首日基线为 N/A', () => {
      const input: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'First Day Skip',
        synthetic: true,
        zone: {
          label: 'America/New_York',
          snapshot: 'frozen-2026',
          segments: [...NEW_YORK_SEGMENTS],
        },
        schedule: {
          frequency: 'daily',
          startDate: '2026-03-08',
          endDate: '2026-03-09',
          localTime: '02:30',
          byWeekday: [],
        },
        policy: {
          gap: 'skip',
          fold: 'earlier',
        },
      };

      const mockSelected: SelectedMapping[] = [
        {
          requestedLocal: '2026-03-08 02:30',
          status: 'GAP',
          candidatesUtc: [],
          selectedUtc: [],
          realizedLocal: [],
          gapBoundaryUtc: '2026-03-08T07:00:00Z',
        },
        {
          requestedLocal: '2026-03-09 02:30',
          status: 'NORMAL',
          candidatesUtc: ['2026-03-09T06:30:00Z'],
          selectedUtc: ['2026-03-09T06:30:00Z'],
          realizedLocal: ['2026-03-09 02:30'],
          gapBoundaryUtc: null,
        },
      ];

      const res = buildComparison(input, mockSelected);
      expect(res[0]!.baselineUtc).toBeNull();
      expect(res[0]!.driftMinutes).toBeNull();

      expect(res[1]!.baselineUtc).toBe('2026-03-09T06:30:00Z');
      expect(res[1]!.driftMinutes).toBe(0);
    });
  });

  describe('both 模式下第二分支只作 EXTRA_FOLD_INSTANCE 不参与单值基线比较', () => {
    it('daily 遇到 fold=both 时，driftMinutes 严格基于 firstSelectedUtc 计算', () => {
      const input: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'Daily Both Fold Test',
        synthetic: true,
        zone: {
          label: 'America/New_York',
          snapshot: 'frozen-2026',
          segments: [...NEW_YORK_SEGMENTS],
        },
        schedule: {
          frequency: 'daily',
          startDate: '2026-10-31',
          endDate: '2026-11-01',
          localTime: '01:30',
          byWeekday: [],
        },
        policy: {
          gap: 'skip',
          fold: 'both',
        },
      };

      const result = analyze(input);
      expect(result.requestCount).toBe(2);
      expect(result.selectedCount).toBe(3); // 1st day 1 + 2nd day 2

      const day1 = result.occurrences[0]!;
      expect(day1.requestedLocal).toBe('2026-10-31 01:30');
      expect(day1.selectedUtc).toEqual(['2026-10-31T05:30:00Z']);
      expect(day1.baselineUtc).toBe('2026-10-31T05:30:00Z');
      expect(day1.driftMinutes).toBe(0);

      const day2 = result.occurrences[1]!;
      expect(day2.requestedLocal).toBe('2026-11-01 01:30');
      expect(day2.status).toBe('FOLD');
      expect(day2.selectedUtc).toEqual([
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
      ]);
      // baseline = 2026-10-31T05:30:00Z + 1440 min = 2026-11-01T05:30:00Z
      expect(day2.baselineUtc).toBe('2026-11-01T05:30:00Z');
      // driftMinutes = baselineUtc - firstSelectedUtc = 05:30 - 05:30 = 0
      expect(day2.driftMinutes).toBe(0);

      // 首个见证由于同日发生了 FOLD，优先归因 FOLD
      expect(result.firstWitness.type).toBe('FOLD');
      expect(result.firstWitness.date).toBe('2026-11-01');
      expect(result.firstWitness.boundaryUtc).toBe('2026-11-01T06:00:00Z');
    });
  });

  describe('跨月与跨年公历换算验证（前车之鉴防御）', () => {
    it('跨 2 月到 3 月 (平年 28 天) 的 weekly 日期基线换算严格准确', () => {
      // 2026-02-23 (Mon) 到 2026-03-09 (Mon)，相距 14 天
      expect(diffDays('2026-02-23', '2026-03-09')).toBe(14);
      expect(addDays('2026-02-23', 14)).toBe('2026-03-09');

      const input: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'Cross Month Feb-Mar Test',
        synthetic: true,
        zone: {
          label: 'Asia/Tokyo',
          snapshot: 'frozen-2026',
          segments: [...TOKYO_SEGMENTS],
        },
        schedule: {
          frequency: 'weekly',
          startDate: '2026-02-23',
          endDate: '2026-03-09',
          localTime: '10:00',
          byWeekday: [1],
        },
        policy: {
          gap: 'skip',
          fold: 'earlier',
        },
      };

      const result = analyze(input);
      expect(result.requestCount).toBe(3); // 02-23, 03-02, 03-09
      expect(result.occurrences[0]!.baselineUtc).toBe('2026-02-23T01:00:00Z');
      expect(result.occurrences[1]!.baselineUtc).toBe('2026-03-02T01:00:00Z');
      expect(result.occurrences[2]!.baselineUtc).toBe('2026-03-09T01:00:00Z');
      expect(result.occurrences[2]!.driftMinutes).toBe(0);
    });

    it('跨 10 月到 11 月 (31 天) 的 daily 日期基线换算严格准确', () => {
      expect(diffDays('2026-10-30', '2026-11-02')).toBe(3);
      expect(addDays('2026-10-30', 3)).toBe('2026-11-02');

      const input: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'Cross Month Oct-Nov Test',
        synthetic: true,
        zone: {
          label: 'UTC',
          snapshot: 'frozen-2026',
          segments: [...UTC_SEGMENTS],
        },
        schedule: {
          frequency: 'daily',
          startDate: '2026-10-30',
          endDate: '2026-11-02',
          localTime: '12:00',
          byWeekday: [],
        },
        policy: {
          gap: 'skip',
          fold: 'earlier',
        },
      };

      const result = analyze(input);
      expect(result.requestCount).toBe(4);
      expect(result.occurrences[0]!.baselineUtc).toBe('2026-10-30T12:00:00Z');
      expect(result.occurrences[1]!.baselineUtc).toBe('2026-10-31T12:00:00Z');
      expect(result.occurrences[2]!.baselineUtc).toBe('2026-11-01T12:00:00Z');
      expect(result.occurrences[3]!.baselineUtc).toBe('2026-11-02T12:00:00Z');
    });

    it('跨年 2025-12-31 到 2026-01-02 的基线计算严格准确', () => {
      expect(diffDays('2025-12-31', '2026-01-02')).toBe(2);

      const input: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'Cross Year Test',
        synthetic: true,
        zone: {
          label: 'UTC',
          snapshot: 'frozen-2026',
          segments: [...UTC_SEGMENTS],
        },
        schedule: {
          frequency: 'daily',
          startDate: '2025-12-31',
          endDate: '2026-01-02',
          localTime: '00:00',
          byWeekday: [],
        },
        policy: {
          gap: 'skip',
          fold: 'earlier',
        },
      };

      const result = analyze(input);
      expect(result.requestCount).toBe(3);
      expect(result.occurrences[0]!.baselineUtc).toBe('2025-12-31T00:00:00Z');
      expect(result.occurrences[1]!.baselineUtc).toBe('2026-01-01T00:00:00Z');
      expect(result.occurrences[2]!.baselineUtc).toBe('2026-01-02T00:00:00Z');
    });
  });

  describe('纯数据与不变性验证', () => {
    it('调用 analyze() 不变异输入对象 (Object.freeze 保护)', () => {
      const input: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'Immutable Test',
        synthetic: true,
        zone: {
          label: 'Asia/Tokyo',
          snapshot: 'frozen-2026',
          segments: [...TOKYO_SEGMENTS],
        },
        schedule: {
          frequency: 'daily',
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          localTime: '09:00',
          byWeekday: [],
        },
        policy: {
          gap: 'skip',
          fold: 'earlier',
        },
      };

      // 深度冻结
      Object.freeze(input);
      Object.freeze(input.zone);
      Object.freeze(input.schedule);
      Object.freeze(input.policy);

      expect(() => analyze(input)).not.toThrow();
    });

    it('非法输入时抛出带 code/path 的结构化 TimeFoldError', () => {
      const invalidInput = {
        schema: 'timefold.spec/1',
        name: 'Bad Input',
        synthetic: true,
        zone: {
          label: 'Asia/Tokyo',
          snapshot: 'frozen-2026',
          segments: [...TOKYO_SEGMENTS],
        },
        schedule: {
          frequency: 'daily',
          startDate: '2026-06-05',
          endDate: '2026-06-01', // start > end
          localTime: '09:00',
          byWeekday: [],
        },
        policy: {
          gap: 'skip',
          fold: 'earlier',
        },
      } as unknown as TimeFoldInput;

      expect(() => analyze(invalidInput)).toThrow(TimeFoldError);
    });
  });
});
