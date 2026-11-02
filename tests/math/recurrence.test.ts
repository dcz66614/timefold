import { describe, expect, it } from 'vitest';
import {
  expandLocalDates,
  expandScheduleMappings,
  MAX_REQUEST_DATES,
  resolveMapping,
} from '../../src/core/recurrence';
import { mapLocal } from '../../src/core/map';
import {
  LONDON_SEGMENTS,
  NEW_YORK_SEGMENTS,
  TOKYO_SEGMENTS,
  UTC_SEGMENTS,
} from '../../src/core/zones';
import {
  type MappingCandidate,
  type TimeFoldInput,
  type TimeFoldPolicy,
  type TimeFoldSchedule,
  TimeFoldError,
} from '../../src/core/types';
import { parseUtcMinute } from '../../src/core/calendar';

describe('P009-T006 — 缺口策略与日/周请求展开 (recurrence.ts)', () => {
  describe('1. MATH07 与策略裁决 (TF-A, TF-B, TF-C, TF-D)', () => {
    it('MATH07 / TF-A: 纽约 2026-03-08 02:30 (GAP) skip 不创建实例，shiftForward 映射到 07:00Z / 03:00 local', () => {
      const candidate = mapLocal('2026-03-08 02:30', NEW_YORK_SEGMENTS);
      expect(candidate.status).toBe('GAP');
      expect(candidate.candidatesUtc).toEqual([]);
      expect(candidate.gapBoundaryUtc).toBe('2026-03-08T07:00:00Z');

      // 1.1 gapPolicy: skip
      const skipPolicy: TimeFoldPolicy = { gap: 'skip', fold: 'earlier' };
      const skipRes = resolveMapping(candidate, skipPolicy, NEW_YORK_SEGMENTS);

      expect(skipRes.requestedLocal).toBe('2026-03-08 02:30');
      expect(skipRes.status).toBe('GAP');
      expect(skipRes.candidatesUtc).toEqual([]);
      expect(skipRes.selectedUtc).toEqual([]);
      expect(skipRes.realizedLocal).toEqual([]);
      expect(skipRes.gapBoundaryUtc).toBe('2026-03-08T07:00:00Z');

      // 1.2 gapPolicy: shiftForward
      const shiftPolicy: TimeFoldPolicy = {
        gap: 'shiftForward',
        fold: 'earlier',
      };
      const shiftRes = resolveMapping(
        candidate,
        shiftPolicy,
        NEW_YORK_SEGMENTS
      );

      expect(shiftRes.requestedLocal).toBe('2026-03-08 02:30');
      expect(shiftRes.status).toBe('GAP');
      // 明确断言：不改 candidatesUtc
      expect(shiftRes.candidatesUtc).toEqual([]);
      // 明确断言：selectedUtc 为跃迁边界 07:00Z
      expect(shiftRes.selectedUtc).toEqual(['2026-03-08T07:00:00Z']);
      // 明确断言：realizedLocal 为第一个有效本地分钟 03:00
      expect(shiftRes.realizedLocal).toEqual(['2026-03-08 03:00']);
      // 明确断言：不是 Temporal compatible (03:30)
      expect(shiftRes.realizedLocal[0]).not.toBe('2026-03-08 03:30');
      // 明确断言：实际当地分钟与 UTC 区分
      expect(shiftRes.selectedUtc[0]).not.toBe(shiftRes.realizedLocal[0]);

      // 1.3 检验不传 segs 时自动利用预设推导
      const fallbackRes = resolveMapping(candidate, shiftPolicy);
      expect(fallbackRes.selectedUtc).toEqual(['2026-03-08T07:00:00Z']);
      expect(fallbackRes.realizedLocal).toEqual(['2026-03-08 03:00']);
    });

    it('MATH07 / TF-C: 伦敦 2026-03-29 01:30 (GAP) skip 与 shiftForward (01:00Z / 02:00 local)', () => {
      const candidate = mapLocal('2026-03-29 01:30', LONDON_SEGMENTS);
      expect(candidate.status).toBe('GAP');
      expect(candidate.candidatesUtc).toEqual([]);
      expect(candidate.gapBoundaryUtc).toBe('2026-03-29T01:00:00Z');

      // skip 策略
      const skipRes = resolveMapping(
        candidate,
        { gap: 'skip', fold: 'earlier' },
        LONDON_SEGMENTS
      );
      expect(skipRes.selectedUtc).toEqual([]);
      expect(skipRes.realizedLocal).toEqual([]);

      // shiftForward 策略
      const shiftRes = resolveMapping(
        candidate,
        { gap: 'shiftForward', fold: 'earlier' },
        LONDON_SEGMENTS
      );
      expect(shiftRes.candidatesUtc).toEqual([]);
      expect(shiftRes.selectedUtc).toEqual(['2026-03-29T01:00:00Z']);
      expect(shiftRes.realizedLocal).toEqual(['2026-03-29 02:00']);
      // 明确断言：不是 Temporal compatible (02:30)
      expect(shiftRes.realizedLocal[0]).not.toBe('2026-03-29 02:30');
      // 区分当地分钟与 UTC
      expect(shiftRes.selectedUtc[0]).toBe('2026-03-29T01:00:00Z');
      expect(shiftRes.realizedLocal[0]).toBe('2026-03-29 02:00');
    });

    it('MATH07 / TF-B: 纽约 2026-11-01 01:30 (FOLD) earlier/later/both 选中数 1/1/2，不改 candidates，双实例唯一性', () => {
      const candidate = mapLocal('2026-11-01 01:30', NEW_YORK_SEGMENTS);
      expect(candidate.status).toBe('FOLD');
      expect(candidate.candidatesUtc).toEqual([
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
      ]);
      const originalCandidates = [...candidate.candidatesUtc];

      // 1. earlier
      const earlierRes = resolveMapping(
        candidate,
        { gap: 'skip', fold: 'earlier' },
        NEW_YORK_SEGMENTS
      );
      expect(earlierRes.status).toBe('FOLD');
      expect(earlierRes.candidatesUtc).toEqual(originalCandidates);
      expect(earlierRes.selectedUtc).toHaveLength(1);
      expect(earlierRes.selectedUtc[0]).toBe('2026-11-01T05:30:00Z');
      expect(earlierRes.realizedLocal).toEqual(['2026-11-01 01:30']);

      // 2. later
      const laterRes = resolveMapping(
        candidate,
        { gap: 'skip', fold: 'later' },
        NEW_YORK_SEGMENTS
      );
      expect(laterRes.status).toBe('FOLD');
      expect(laterRes.candidatesUtc).toEqual(originalCandidates);
      expect(laterRes.selectedUtc).toHaveLength(1);
      expect(laterRes.selectedUtc[0]).toBe('2026-11-01T06:30:00Z');
      expect(laterRes.realizedLocal).toEqual(['2026-11-01 01:30']);

      // 3. both
      const bothRes = resolveMapping(
        candidate,
        { gap: 'skip', fold: 'both' },
        NEW_YORK_SEGMENTS
      );
      expect(bothRes.status).toBe('FOLD');
      expect(bothRes.candidatesUtc).toEqual(originalCandidates);
      expect(bothRes.selectedUtc).toHaveLength(2);
      expect(bothRes.selectedUtc).toEqual([
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
      ]);
      // 双实例 local 均为 01:30
      expect(bothRes.realizedLocal).toEqual([
        '2026-11-01 01:30',
        '2026-11-01 01:30',
      ]);

      // 双实例唯一性断言
      expect(bothRes.selectedUtc[0]).not.toBe(bothRes.selectedUtc[1]);
      const m0 = parseUtcMinute(bothRes.selectedUtc[0]!);
      const m1 = parseUtcMinute(bothRes.selectedUtc[1]!);
      expect(m1 - m0).toBe(60);

      // candidates 未受污染
      expect(candidate.candidatesUtc).toEqual(originalCandidates);
    });

    it('TF-D: 伦敦 2026-10-25 01:30 (FOLD) earlier/later/both 裁决', () => {
      const candidate = mapLocal('2026-10-25 01:30', LONDON_SEGMENTS);
      expect(candidate.status).toBe('FOLD');
      expect(candidate.candidatesUtc).toEqual([
        '2026-10-25T00:30:00Z',
        '2026-10-25T01:30:00Z',
      ]);

      // earlier
      const earlierRes = resolveMapping(candidate, {
        gap: 'skip',
        fold: 'earlier',
      });
      expect(earlierRes.selectedUtc).toEqual(['2026-10-25T00:30:00Z']);

      // later
      const laterRes = resolveMapping(candidate, {
        gap: 'skip',
        fold: 'later',
      });
      expect(laterRes.selectedUtc).toEqual(['2026-10-25T01:30:00Z']);

      // both
      const bothRes = resolveMapping(candidate, {
        gap: 'skip',
        fold: 'both',
      });
      expect(bothRes.selectedUtc).toEqual([
        '2026-10-25T00:30:00Z',
        '2026-10-25T01:30:00Z',
      ]);
      expect(bothRes.realizedLocal).toEqual([
        '2026-10-25 01:30',
        '2026-10-25 01:30',
      ]);
    });

    it('正常单候选 (NORMAL) 不受 gap/fold 策略影响', () => {
      const candidate = mapLocal('2026-06-01 09:00', TOKYO_SEGMENTS);
      expect(candidate.status).toBe('NORMAL');
      expect(candidate.candidatesUtc).toEqual(['2026-06-01T00:00:00Z']);

      const policies: TimeFoldPolicy[] = [
        { gap: 'skip', fold: 'earlier' },
        { gap: 'skip', fold: 'later' },
        { gap: 'skip', fold: 'both' },
        { gap: 'shiftForward', fold: 'earlier' },
        { gap: 'shiftForward', fold: 'later' },
        { gap: 'shiftForward', fold: 'both' },
      ];

      for (const policy of policies) {
        const res = resolveMapping(candidate, policy, TOKYO_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-06-01T00:00:00Z']);
        expect(res.selectedUtc).toEqual(['2026-06-01T00:00:00Z']);
        expect(res.realizedLocal).toEqual(['2026-06-01 09:00']);
        expect(res.gapBoundaryUtc).toBeNull();
      }
    });

    it('全部 skip 时断言：所有缺失项 selectedUtc 为空，总选中数为 0', () => {
      // 构造全缺口输入
      const tfAInput: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'TF-A All Skip Witness',
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

      const mappings = expandScheduleMappings(tfAInput);
      expect(mappings).toHaveLength(1);
      expect(mappings[0]!.status).toBe('GAP');
      expect(mappings[0]!.candidatesUtc).toEqual([]);
      expect(mappings[0]!.selectedUtc).toEqual([]);
      expect(mappings[0]!.realizedLocal).toEqual([]);

      const totalSelected = mappings.reduce(
        (sum, m) => sum + m.selectedUtc.length,
        0
      );
      expect(totalSelected).toBe(0);
    });
  });

  describe('2. once / daily / weekly 日期展开基础与星期筛选', () => {
    it('once: 只生成 startDate，且要求 startDate === endDate', () => {
      const schedule: TimeFoldSchedule = {
        frequency: 'once',
        startDate: '2026-03-08',
        endDate: '2026-03-08',
        localTime: '02:30',
        byWeekday: [],
      };
      const dates = expandLocalDates(schedule);
      expect(dates).toEqual(['2026-03-08']);

      // startDate !== endDate 拒绝
      const invalidOnce: TimeFoldSchedule = {
        ...schedule,
        endDate: '2026-03-09',
      };
      expect(() => expandLocalDates(invalidOnce)).toThrowError(TimeFoldError);
      try {
        expandLocalDates(invalidOnce);
      } catch (e: any) {
        expect(e.code).toBe('E_ONCE_DATES_NOT_EQUAL');
      }
    });

    it('daily: 逐日生成，递增无遗漏', () => {
      const schedule: TimeFoldSchedule = {
        frequency: 'daily',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        localTime: '09:00',
        byWeekday: [],
      };
      const dates = expandLocalDates(schedule);
      expect(dates).toEqual([
        '2026-06-01',
        '2026-06-02',
        '2026-06-03',
        '2026-06-04',
        '2026-06-05',
      ]);
    });

    it('weekly: 按 ISO 星期集合严格筛选并递增 (含 2026-03-09 星期一)', () => {
      // 筛选周一 (1)
      const scheduleMon: TimeFoldSchedule = {
        frequency: 'weekly',
        startDate: '2026-03-02',
        endDate: '2026-03-23',
        localTime: '09:00',
        byWeekday: [1],
      };
      const mondays = expandLocalDates(scheduleMon);
      expect(mondays).toEqual([
        '2026-03-02',
        '2026-03-09',
        '2026-03-16',
        '2026-03-23',
      ]);
      // 确认 2026-03-09 在筛选出的周一列表中
      expect(mondays).toContain('2026-03-09');

      // 筛选周三与周五 (3, 5)
      const scheduleWedFri: TimeFoldSchedule = {
        frequency: 'weekly',
        startDate: '2026-03-01', // 2026-03-01 是周日 (7)
        endDate: '2026-03-10', // 2026-03-10 是周二 (2)
        localTime: '10:00',
        byWeekday: [3, 5],
      };
      // 2026-03-04 (Wed), 2026-03-06 (Fri)
      const wedFris = expandLocalDates(scheduleWedFri);
      expect(wedFris).toEqual(['2026-03-04', '2026-03-06']);

      // 筛选周末 (6, 7)
      const scheduleWeekend: TimeFoldSchedule = {
        frequency: 'weekly',
        startDate: '2026-03-06', // Fri
        endDate: '2026-03-15', // Sun
        localTime: '12:00',
        byWeekday: [6, 7],
      };
      // Sat 03-07, Sun 03-08, Sat 03-14, Sun 03-15
      const weekends = expandLocalDates(scheduleWeekend);
      expect(weekends).toEqual([
        '2026-03-07',
        '2026-03-08',
        '2026-03-14',
        '2026-03-15',
      ]);
    });
  });

  describe('3. 前车之鉴：跨月与跨年日期展开全面覆盖', () => {
    it('覆盖 1月到2月跨月 (31天月份)', () => {
      const schedule: TimeFoldSchedule = {
        frequency: 'daily',
        startDate: '2026-01-28',
        endDate: '2026-02-04',
        localTime: '00:00',
        byWeekday: [],
      };
      const dates = expandLocalDates(schedule);
      expect(dates).toEqual([
        '2026-01-28',
        '2026-01-29',
        '2026-01-30',
        '2026-01-31',
        '2026-02-01',
        '2026-02-02',
        '2026-02-03',
        '2026-02-04',
      ]);
      expect(dates).toHaveLength(8);
    });

    it('覆盖 2月到3月跨月 (2026 平年 28 天)', () => {
      const schedule: TimeFoldSchedule = {
        frequency: 'daily',
        startDate: '2026-02-26',
        endDate: '2026-03-04',
        localTime: '00:00',
        byWeekday: [],
      };
      const dates = expandLocalDates(schedule);
      expect(dates).toEqual([
        '2026-02-26',
        '2026-02-27',
        '2026-02-28',
        '2026-03-01',
        '2026-03-02',
        '2026-03-03',
        '2026-03-04',
      ]);
      expect(dates).toHaveLength(7);
      // 确认绝不存在 2026-02-29
      expect(dates).not.toContain('2026-02-29');
    });

    it('覆盖 3月到4月跨月 (31天月份)', () => {
      const schedule: TimeFoldSchedule = {
        frequency: 'daily',
        startDate: '2026-03-29',
        endDate: '2026-04-03',
        localTime: '00:00',
        byWeekday: [],
      };
      const dates = expandLocalDates(schedule);
      expect(dates).toEqual([
        '2026-03-29',
        '2026-03-30',
        '2026-03-31',
        '2026-04-01',
        '2026-04-02',
        '2026-04-03',
      ]);
      expect(dates).toHaveLength(6);
    });

    it('覆盖 4月到5月跨月 (30天月份)', () => {
      const schedule: TimeFoldSchedule = {
        frequency: 'daily',
        startDate: '2026-04-28',
        endDate: '2026-05-02',
        localTime: '00:00',
        byWeekday: [],
      };
      const dates = expandLocalDates(schedule);
      expect(dates).toEqual([
        '2026-04-28',
        '2026-04-29',
        '2026-04-30',
        '2026-05-01',
        '2026-05-02',
      ]);
      expect(dates).toHaveLength(5);
      expect(dates).not.toContain('2026-04-31');
    });

    it('覆盖 12月到次年1月跨年', () => {
      const schedule: TimeFoldSchedule = {
        frequency: 'daily',
        startDate: '2026-12-28',
        endDate: '2027-01-03',
        localTime: '00:00',
        byWeekday: [],
      };
      const dates = expandLocalDates(schedule);
      expect(dates).toEqual([
        '2026-12-28',
        '2026-12-29',
        '2026-12-30',
        '2026-12-31',
        '2027-01-01',
        '2027-01-02',
        '2027-01-03',
      ]);
      expect(dates).toHaveLength(7);
    });

    it('覆盖跨月 weekly 筛选', () => {
      // 跨越 2 月与 3 月的周一筛选
      const schedule: TimeFoldSchedule = {
        frequency: 'weekly',
        startDate: '2026-02-23', // Mon
        endDate: '2026-03-16', // Mon
        localTime: '09:00',
        byWeekday: [1],
      };
      const dates = expandLocalDates(schedule);
      expect(dates).toEqual([
        '2026-02-23',
        '2026-03-02',
        '2026-03-09',
        '2026-03-16',
      ]);
    });
  });

  describe('4. 90 请求上限控制（恰好 90 通过、超 90 拒绝）', () => {
    it('daily: 恰好 90 个请求日期顺利通过 (2026-01-01 至 2026-03-31)', () => {
      // 2026 年 1 月 31 天 + 2 月 28 天 + 3 月 31 天 = 90 天
      const schedule: TimeFoldSchedule = {
        frequency: 'daily',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        localTime: '08:00',
        byWeekday: [],
      };
      const dates = expandLocalDates(schedule);
      expect(dates).toHaveLength(90);
      expect(dates).toHaveLength(MAX_REQUEST_DATES);
      expect(dates[0]).toBe('2026-01-01');
      expect(dates[89]).toBe('2026-03-31');
    });

    it('daily: 超过 90 个请求日期 (91 天) 严格拒绝抛出 E_REQUEST_COUNT_EXCEEDED', () => {
      // 2026-01-01 至 2026-04-01 为 91 天
      const schedule: TimeFoldSchedule = {
        frequency: 'daily',
        startDate: '2026-01-01',
        endDate: '2026-04-01',
        localTime: '08:00',
        byWeekday: [],
      };
      expect(() => expandLocalDates(schedule)).toThrowError(TimeFoldError);
      try {
        expandLocalDates(schedule);
      } catch (err: any) {
        expect(err.code).toBe('E_REQUEST_COUNT_EXCEEDED');
        expect(err.path).toBe('schedule');
        expect(err.message).toContain('91');
      }
    });

    it('weekly: 恰好 90 个请求日期顺利通过', () => {
      // 每周 2 次 (周二、周四)，跨 45 周 = 恰好 90 个日期
      // 2026-01-06 (Tue) 起第 45 周的周四是 2026-11-12
      const schedule: TimeFoldSchedule = {
        frequency: 'weekly',
        startDate: '2026-01-06',
        endDate: '2026-11-12',
        localTime: '15:00',
        byWeekday: [2, 4],
      };
      const dates = expandLocalDates(schedule);
      expect(dates).toHaveLength(90);
      expect(dates[0]).toBe('2026-01-06');
      expect(dates[89]).toBe('2026-11-12');
    });

    it('weekly: 超过 90 个请求日期 (91 个) 严格拒绝抛出 E_REQUEST_COUNT_EXCEEDED', () => {
      // 加上下周二 2026-11-17
      const schedule: TimeFoldSchedule = {
        frequency: 'weekly',
        startDate: '2026-01-06',
        endDate: '2026-11-17',
        localTime: '15:00',
        byWeekday: [2, 4],
      };
      expect(() => expandLocalDates(schedule)).toThrowError(TimeFoldError);
      try {
        expandLocalDates(schedule);
      } catch (err: any) {
        expect(err.code).toBe('E_REQUEST_COUNT_EXCEEDED');
        expect(err.path).toBe('schedule');
        expect(err.message).toContain('91');
      }
    });
  });

  describe('5. 异常路径与数据防御', () => {
    it('拒绝 startDate 晚于 endDate', () => {
      const schedule: TimeFoldSchedule = {
        frequency: 'daily',
        startDate: '2026-03-10',
        endDate: '2026-03-08',
        localTime: '10:00',
        byWeekday: [],
      };
      expect(() => expandLocalDates(schedule)).toThrowError(TimeFoldError);
      try {
        expandLocalDates(schedule);
      } catch (e: any) {
        expect(e.code).toBe('E_START_DATE_AFTER_END_DATE');
      }
    });

    it('拒绝非法日期字符串 (如 2026-02-30)', () => {
      const schedule: TimeFoldSchedule = {
        frequency: 'daily',
        startDate: '2026-02-30',
        endDate: '2026-03-05',
        localTime: '10:00',
        byWeekday: [],
      };
      expect(() => expandLocalDates(schedule)).toThrowError(TimeFoldError);
    });

    it('weekly 拒绝空 byWeekday 数组', () => {
      const schedule: TimeFoldSchedule = {
        frequency: 'weekly',
        startDate: '2026-03-01',
        endDate: '2026-03-07',
        localTime: '10:00',
        byWeekday: [],
      };
      expect(() => expandLocalDates(schedule)).toThrowError(TimeFoldError);
      try {
        expandLocalDates(schedule);
      } catch (e: any) {
        expect(e.code).toBe('E_INVALID_BY_WEEKDAY');
      }
    });

    it('weekly 拒绝未排序或包含非 1..7 数字的 byWeekday', () => {
      const invalidCases = [
        [0],
        [8],
        [3, 1], // 未排序
        [2, 2], // 重复
      ];
      for (const bw of invalidCases) {
        const schedule: TimeFoldSchedule = {
          frequency: 'weekly',
          startDate: '2026-03-01',
          endDate: '2026-03-07',
          localTime: '10:00',
          byWeekday: bw as number[],
        };
        expect(() => expandLocalDates(schedule)).toThrowError(TimeFoldError);
      }
    });

    it('weekly 区间无任何匹配日期时抛出 E_REQUEST_COUNT_EMPTY', () => {
      // 2026-03-02 是周一 (1)，2026-03-03 是周二 (2)
      // 筛选周日 (7)，期间没有任何匹配
      const schedule: TimeFoldSchedule = {
        frequency: 'weekly',
        startDate: '2026-03-02',
        endDate: '2026-03-03',
        localTime: '10:00',
        byWeekday: [7],
      };
      expect(() => expandLocalDates(schedule)).toThrowError(TimeFoldError);
      try {
        expandLocalDates(schedule);
      } catch (e: any) {
        expect(e.code).toBe('E_REQUEST_COUNT_EMPTY');
      }
    });

    it('resolveMapping 校验非法策略', () => {
      const candidate: MappingCandidate = {
        requestedLocal: '2026-03-08 02:30',
        status: 'GAP',
        candidatesUtc: [],
        gapBoundaryUtc: '2026-03-08T07:00:00Z',
      };
      expect(() =>
        resolveMapping(candidate, {
          gap: 'invalid' as any,
          fold: 'earlier',
        })
      ).toThrowError(TimeFoldError);

      expect(() =>
        resolveMapping(candidate, {
          gap: 'skip',
          fold: 'invalid' as any,
        })
      ).toThrowError(TimeFoldError);
    });

    it('TimeFoldInput 包裹对象可直接作为 expandLocalDates 参数', () => {
      const input: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'Wrapped Input Test',
        synthetic: true,
        zone: {
          label: 'UTC',
          snapshot: 'frozen-2026',
          segments: [...UTC_SEGMENTS],
        },
        schedule: {
          frequency: 'daily',
          startDate: '2026-05-01',
          endDate: '2026-05-03',
          localTime: '12:00',
          byWeekday: [],
        },
        policy: {
          gap: 'skip',
          fold: 'earlier',
        },
      };

      const dates = expandLocalDates(input);
      expect(dates).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
    });
  });

  describe('6. 完整排程展开与裁决集成测试 (expandScheduleMappings)', () => {
    it('TF-B 预设：展开 once 产生 1 个 FOLD 结果，双实例各具候选', () => {
      const tfB: TimeFoldInput = {
        schema: 'timefold.spec/1',
        name: 'TF-B Fall Fold',
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

      const res = expandScheduleMappings(tfB);
      expect(res).toHaveLength(1);
      const m0 = res[0]!;
      expect(m0.requestedLocal).toBe('2026-11-01 01:30');
      expect(m0.status).toBe('FOLD');
      expect(m0.candidatesUtc).toEqual([
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
      ]);
      expect(m0.selectedUtc).toEqual([
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
      ]);
      expect(m0.realizedLocal).toEqual([
        '2026-11-01 01:30',
        '2026-11-01 01:30',
      ]);
    });

    it('TF-E 预设：展开 daily 3 日常态产生 3 个 NORMAL 结果', () => {
      const tfE: TimeFoldInput = {
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

      const res = expandScheduleMappings(tfE);
      expect(res).toHaveLength(3);
      for (const m of res) {
        expect(m.status).toBe('NORMAL');
        expect(m.candidatesUtc).toHaveLength(1);
        expect(m.selectedUtc).toHaveLength(1);
        expect(m.realizedLocal).toHaveLength(1);
      }
      expect(res[0]!.selectedUtc[0]).toBe('2026-06-01T00:00:00Z');
      expect(res[1]!.selectedUtc[0]).toBe('2026-06-02T00:00:00Z');
      expect(res[2]!.selectedUtc[0]).toBe('2026-06-03T00:00:00Z');
    });
  });
});
