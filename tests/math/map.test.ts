import { describe, expect, it } from 'vitest';
import {
  findCandidateUtcMinutes,
  mapLocal,
  projectUtc,
} from '../../src/core/map';
import {
  parseLocalMinute,
  parseUtcMinute,
} from '../../src/core/calendar';
import {
  LONDON_SEGMENTS,
  NEW_YORK_SEGMENTS,
  TOKYO_SEGMENTS,
  UTC_SEGMENTS,
  ZONE_END_UTC,
  ZONE_START_UTC,
} from '../../src/core/zones';
import { TimeFoldError, type ZoneSegment } from '../../src/core/types';

describe('P009-T005 — 墙上时间反像核心 (map.ts)', () => {
  describe('项目书 §8 黄金值精确断言 (MATH02–MATH06)', () => {
    it('MATH02: 东京 2026-06-01 09:00 → 唯一 2026-06-01T00:00:00Z (NORMAL, 候选数 1)', () => {
      const res = mapLocal('2026-06-01 09:00', TOKYO_SEGMENTS);

      expect(res.requestedLocal).toBe('2026-06-01 09:00');
      expect(res.status).toBe('NORMAL');
      expect(res.candidatesUtc).toHaveLength(1);
      expect(res.candidatesUtc[0]).toBe('2026-06-01T00:00:00Z');
      expect(res.gapBoundaryUtc).toBeNull();

      // 双向检验：反投回当地时间必须精确一致
      expect(projectUtc(res.candidatesUtc[0]!, TOKYO_SEGMENTS)).toBe('2026-06-01 09:00');
    });

    it('MATH03: 纽约 2026-03-08 02:30 → 候选 0、状态 GAP (夏令时跳时空洞)', () => {
      const res = mapLocal('2026-03-08 02:30', NEW_YORK_SEGMENTS);

      expect(res.requestedLocal).toBe('2026-03-08 02:30');
      expect(res.status).toBe('GAP');
      expect(res.candidatesUtc).toHaveLength(0);
      expect(res.gapBoundaryUtc).toBe('2026-03-08T07:00:00Z');
    });

    it('MATH04: 纽约 2026-11-01 01:30 → 05:30Z 与 06:30Z、升序、差 60 分钟 (FOLD, 候选数 2)', () => {
      const res = mapLocal('2026-11-01 01:30', NEW_YORK_SEGMENTS);

      expect(res.requestedLocal).toBe('2026-11-01 01:30');
      expect(res.status).toBe('FOLD');
      expect(res.candidatesUtc).toHaveLength(2);
      expect(res.candidatesUtc[0]).toBe('2026-11-01T05:30:00Z');
      expect(res.candidatesUtc[1]).toBe('2026-11-01T06:30:00Z');
      expect(res.gapBoundaryUtc).toBeNull();

      // 严格升序与相差恰好 60 分钟断言
      const m0 = parseUtcMinute(res.candidatesUtc[0]!);
      const m1 = parseUtcMinute(res.candidatesUtc[1]!);
      expect(m1).toBeGreaterThan(m0);
      expect(m1 - m0).toBe(60);

      // 双向检验：两个候选均精确投影到请求当地分钟 01:30
      expect(projectUtc(res.candidatesUtc[0]!, NEW_YORK_SEGMENTS)).toBe('2026-11-01 01:30');
      expect(projectUtc(res.candidatesUtc[1]!, NEW_YORK_SEGMENTS)).toBe('2026-11-01 01:30');
    });

    it('MATH05: 伦敦 2026-03-29 01:30 → 候选 0、状态 GAP、边界 2026-03-29T01:00:00Z', () => {
      const res = mapLocal('2026-03-29 01:30', LONDON_SEGMENTS);

      expect(res.requestedLocal).toBe('2026-03-29 01:30');
      expect(res.status).toBe('GAP');
      expect(res.candidatesUtc).toHaveLength(0);
      expect(res.gapBoundaryUtc).toBe('2026-03-29T01:00:00Z');
    });

    it('MATH06: 伦敦 2026-10-25 01:30 → 00:30Z 与 01:30Z、升序、差 60 分钟 (FOLD, 候选数 2)', () => {
      const res = mapLocal('2026-10-25 01:30', LONDON_SEGMENTS);

      expect(res.requestedLocal).toBe('2026-10-25 01:30');
      expect(res.status).toBe('FOLD');
      expect(res.candidatesUtc).toHaveLength(2);
      expect(res.candidatesUtc[0]).toBe('2026-10-25T00:30:00Z');
      expect(res.candidatesUtc[1]).toBe('2026-10-25T01:30:00Z');
      expect(res.gapBoundaryUtc).toBeNull();

      // 严格升序与相差恰好 60 分钟断言
      const m0 = parseUtcMinute(res.candidatesUtc[0]!);
      const m1 = parseUtcMinute(res.candidatesUtc[1]!);
      expect(m1).toBeGreaterThan(m0);
      expect(m1 - m0).toBe(60);

      // 双向检验：两个候选均精确投影到当地 01:30
      expect(projectUtc(res.candidatesUtc[0]!, LONDON_SEGMENTS)).toBe('2026-10-25 01:30');
      expect(projectUtc(res.candidatesUtc[1]!, LONDON_SEGMENTS)).toBe('2026-10-25 01:30');
    });
  });

  describe('半开区间连续边界前后各一分钟及关键点用例', () => {
    describe('伦敦夏令时跳时 (2026-03-29 01:00 跃迁，GMT 0 -> BST +60)', () => {
      it('跳时缺口前 1 分钟: 00:59 为 NORMAL (唯一 00:59Z)', () => {
        const res = mapLocal('2026-03-29 00:59', LONDON_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-03-29T00:59:00Z']);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, LONDON_SEGMENTS)).toBe('2026-03-29 00:59');
      });

      it('跳时缺口起点边界: 01:00 属于 GAP (候选 0, boundary 01:00Z)', () => {
        const res = mapLocal('2026-03-29 01:00', LONDON_SEGMENTS);
        expect(res.status).toBe('GAP');
        expect(res.candidatesUtc).toHaveLength(0);
        expect(res.gapBoundaryUtc).toBe('2026-03-29T01:00:00Z');
      });

      it('跳时缺口起点后 1 分钟: 01:01 属于 GAP (候选 0, boundary 01:00Z)', () => {
        const res = mapLocal('2026-03-29 01:01', LONDON_SEGMENTS);
        expect(res.status).toBe('GAP');
        expect(res.candidatesUtc).toHaveLength(0);
        expect(res.gapBoundaryUtc).toBe('2026-03-29T01:00:00Z');
      });

      it('跳时缺口结束前 1 分钟: 01:59 属于 GAP (候选 0, boundary 01:00Z)', () => {
        const res = mapLocal('2026-03-29 01:59', LONDON_SEGMENTS);
        expect(res.status).toBe('GAP');
        expect(res.candidatesUtc).toHaveLength(0);
        expect(res.gapBoundaryUtc).toBe('2026-03-29T01:00:00Z');
      });

      it('跳时缺口恢复点: 02:00 为 NORMAL (唯一 01:00Z, 新段起点生效)', () => {
        const res = mapLocal('2026-03-29 02:00', LONDON_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-03-29T01:00:00Z']);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, LONDON_SEGMENTS)).toBe('2026-03-29 02:00');
      });

      it('跳时恢复后 1 分钟: 02:01 为 NORMAL (唯一 01:01Z)', () => {
        const res = mapLocal('2026-03-29 02:01', LONDON_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-03-29T01:01:00Z']);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, LONDON_SEGMENTS)).toBe('2026-03-29 02:01');
      });
    });

    describe('伦敦夏令时折返 (2026-10-25 01:00 跃迁，BST +60 -> GMT 0)', () => {
      it('折返区间前 1 分钟: 00:59 为 NORMAL (唯一 2026-10-24T23:59:00Z，仍处于 BST)', () => {
        const res = mapLocal('2026-10-25 00:59', LONDON_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-10-24T23:59:00Z']);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, LONDON_SEGMENTS)).toBe('2026-10-25 00:59');
      });

      it('折返区间起点: 01:00 为 FOLD (候选 [00:00Z, 01:00Z])', () => {
        const res = mapLocal('2026-10-25 01:00', LONDON_SEGMENTS);
        expect(res.status).toBe('FOLD');
        expect(res.candidatesUtc).toEqual([
          '2026-10-25T00:00:00Z',
          '2026-10-25T01:00:00Z',
        ]);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, LONDON_SEGMENTS)).toBe('2026-10-25 01:00');
        expect(projectUtc(res.candidatesUtc[1]!, LONDON_SEGMENTS)).toBe('2026-10-25 01:00');
      });

      it('折返起点后 1 分钟: 01:01 为 FOLD (候选 [00:01Z, 01:01Z])', () => {
        const res = mapLocal('2026-10-25 01:01', LONDON_SEGMENTS);
        expect(res.status).toBe('FOLD');
        expect(res.candidatesUtc).toEqual([
          '2026-10-25T00:01:00Z',
          '2026-10-25T01:01:00Z',
        ]);
        expect(res.gapBoundaryUtc).toBeNull();
      });

      it('折返结束前 1 分钟: 01:59 为 FOLD (候选 [00:59Z, 01:59Z])', () => {
        const res = mapLocal('2026-10-25 01:59', LONDON_SEGMENTS);
        expect(res.status).toBe('FOLD');
        expect(res.candidatesUtc).toEqual([
          '2026-10-25T00:59:00Z',
          '2026-10-25T01:59:00Z',
        ]);
        expect(res.gapBoundaryUtc).toBeNull();
      });

      it('折返区间结束点: 02:00 为 NORMAL (唯一 02:00Z，旧 BST 段在此右开截止)', () => {
        const res = mapLocal('2026-10-25 02:00', LONDON_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-10-25T02:00:00Z']);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, LONDON_SEGMENTS)).toBe('2026-10-25 02:00');
      });

      it('折返结束后 1 分钟: 02:01 为 NORMAL (唯一 02:01Z)', () => {
        const res = mapLocal('2026-10-25 02:01', LONDON_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-10-25T02:01:00Z']);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, LONDON_SEGMENTS)).toBe('2026-10-25 02:01');
      });
    });

    describe('纽约夏令时跳时 (2026-03-08 07:00Z 跃迁，EST -300 -> EDT -240)', () => {
      it('跳时缺口前 1 分钟: 01:59 为 NORMAL (唯一 06:59Z)', () => {
        const res = mapLocal('2026-03-08 01:59', NEW_YORK_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-03-08T06:59:00Z']);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, NEW_YORK_SEGMENTS)).toBe('2026-03-08 01:59');
      });

      it('跳时缺口起点边界: 02:00 属于 GAP (候选 0, boundary 07:00Z)', () => {
        const res = mapLocal('2026-03-08 02:00', NEW_YORK_SEGMENTS);
        expect(res.status).toBe('GAP');
        expect(res.candidatesUtc).toHaveLength(0);
        expect(res.gapBoundaryUtc).toBe('2026-03-08T07:00:00Z');
      });

      it('跳时缺口起点后 1 分钟: 02:01 属于 GAP (候选 0, boundary 07:00Z)', () => {
        const res = mapLocal('2026-03-08 02:01', NEW_YORK_SEGMENTS);
        expect(res.status).toBe('GAP');
        expect(res.candidatesUtc).toHaveLength(0);
        expect(res.gapBoundaryUtc).toBe('2026-03-08T07:00:00Z');
      });

      it('跳时缺口结束前 1 分钟: 02:59 属于 GAP (候选 0, boundary 07:00Z)', () => {
        const res = mapLocal('2026-03-08 02:59', NEW_YORK_SEGMENTS);
        expect(res.status).toBe('GAP');
        expect(res.candidatesUtc).toHaveLength(0);
        expect(res.gapBoundaryUtc).toBe('2026-03-08T07:00:00Z');
      });

      it('跳时恢复点: 03:00 为 NORMAL (唯一 07:00Z)', () => {
        const res = mapLocal('2026-03-08 03:00', NEW_YORK_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-03-08T07:00:00Z']);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, NEW_YORK_SEGMENTS)).toBe('2026-03-08 03:00');
      });

      it('跳时恢复后 1 分钟: 03:01 为 NORMAL (唯一 07:01Z)', () => {
        const res = mapLocal('2026-03-08 03:01', NEW_YORK_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-03-08T07:01:00Z']);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, NEW_YORK_SEGMENTS)).toBe('2026-03-08 03:01');
      });
    });

    describe('纽约夏令时折返 (2026-11-01 06:00Z 跃迁，EDT -240 -> EST -300)', () => {
      it('折返区间前 1 分钟: 00:59 为 NORMAL (唯一 04:59Z)', () => {
        const res = mapLocal('2026-11-01 00:59', NEW_YORK_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-11-01T04:59:00Z']);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, NEW_YORK_SEGMENTS)).toBe('2026-11-01 00:59');
      });

      it('折返区间起点: 01:00 为 FOLD (候选 [05:00Z, 06:00Z])', () => {
        const res = mapLocal('2026-11-01 01:00', NEW_YORK_SEGMENTS);
        expect(res.status).toBe('FOLD');
        expect(res.candidatesUtc).toEqual([
          '2026-11-01T05:00:00Z',
          '2026-11-01T06:00:00Z',
        ]);
        expect(res.gapBoundaryUtc).toBeNull();
      });

      it('折返起点后 1 分钟: 01:01 为 FOLD (候选 [05:01Z, 06:01Z])', () => {
        const res = mapLocal('2026-11-01 01:01', NEW_YORK_SEGMENTS);
        expect(res.status).toBe('FOLD');
        expect(res.candidatesUtc).toEqual([
          '2026-11-01T05:01:00Z',
          '2026-11-01T06:01:00Z',
        ]);
        expect(res.gapBoundaryUtc).toBeNull();
      });

      it('折返结束前 1 分钟: 01:59 为 FOLD (候选 [05:59Z, 06:59Z])', () => {
        const res = mapLocal('2026-11-01 01:59', NEW_YORK_SEGMENTS);
        expect(res.status).toBe('FOLD');
        expect(res.candidatesUtc).toEqual([
          '2026-11-01T05:59:00Z',
          '2026-11-01T06:59:00Z',
        ]);
        expect(res.gapBoundaryUtc).toBeNull();
      });

      it('折返区间结束点: 02:00 为 NORMAL (唯一 07:00Z，旧 EDT 段在此右开截止)', () => {
        const res = mapLocal('2026-11-01 02:00', NEW_YORK_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-11-01T07:00:00Z']);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, NEW_YORK_SEGMENTS)).toBe('2026-11-01 02:00');
      });

      it('折返结束后 1 分钟: 02:01 为 NORMAL (唯一 07:01Z)', () => {
        const res = mapLocal('2026-11-01 02:01', NEW_YORK_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2026-11-01T07:01:00Z']);
        expect(res.gapBoundaryUtc).toBeNull();
        expect(projectUtc(res.candidatesUtc[0]!, NEW_YORK_SEGMENTS)).toBe('2026-11-01 02:01');
      });
    });

    describe('时区整体范围统一起止边界 (2025-12-30T00:00:00Z 至 2027-01-03T00:00:00Z)', () => {
      it('UTC 时区在 ZONE_START_UTC 起点 2025-12-30 00:00: NORMAL (唯一 2025-12-30T00:00:00Z)', () => {
        const res = mapLocal('2025-12-30 00:00', UTC_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2025-12-30T00:00:00Z']);
      });

      it('UTC 时区在 ZONE_START_UTC 前 1 分钟 2025-12-29 23:59: 候选 0 (超出全覆盖左闭端点)', () => {
        const res = mapLocal('2025-12-29 23:59', UTC_SEGMENTS);
        expect(res.status).toBe('GAP');
        expect(res.candidatesUtc).toHaveLength(0);
        expect(res.gapBoundaryUtc).toBeNull();
      });

      it('UTC 时区在 ZONE_END_UTC 前 1 分钟 2027-01-02 23:59: NORMAL (唯一 2027-01-02T23:59:00Z)', () => {
        const res = mapLocal('2027-01-02 23:59', UTC_SEGMENTS);
        expect(res.status).toBe('NORMAL');
        expect(res.candidatesUtc).toEqual(['2027-01-02T23:59:00Z']);
      });

      it('UTC 时区在 ZONE_END_UTC 终点 2027-01-03 00:00: 候选 0 (右开端点排除)', () => {
        const res = mapLocal('2027-01-03 00:00', UTC_SEGMENTS);
        expect(res.status).toBe('GAP');
        expect(res.candidatesUtc).toHaveLength(0);
        expect(res.gapBoundaryUtc).toBeNull();
      });
    });
  });

  describe('跨月与跨平闰年交界换算专项覆盖 (汲取 T003 diffDays 月份传参教训)', () => {
    it('平年 2 月底跨至 3 月初（东京 +540min）：当地 03-01 跨回 UTC 02-28', () => {
      // 当地 2026-03-01 02:00 JST -> 02:00 - 9h = 前一天 17:00 UTC (2026-02-28 17:00Z)
      const res = mapLocal('2026-03-01 02:00', TOKYO_SEGMENTS);
      expect(res.status).toBe('NORMAL');
      expect(res.candidatesUtc).toEqual(['2026-02-28T17:00:00Z']);
      expect(projectUtc('2026-02-28T17:00:00Z', TOKYO_SEGMENTS)).toBe('2026-03-01 02:00');
    });

    it('平年 2 月底向后跨月（纽约 -300min）：当地 02-28 跨至 UTC 03-01', () => {
      // 当地 2026-02-28 21:00 EST -> 21:00 - (-5h) = 26:00 = 次日 02:00 UTC (2026-03-01 02:00Z)
      const res = mapLocal('2026-02-28 21:00', NEW_YORK_SEGMENTS);
      expect(res.status).toBe('NORMAL');
      expect(res.candidatesUtc).toEqual(['2026-03-01T02:00:00Z']);
      expect(projectUtc('2026-03-01T02:00:00Z', NEW_YORK_SEGMENTS)).toBe('2026-02-28 21:00');
    });

    it('小月 30 天向大月 31 天跨月（纽约 -240min）：4 月底跨至 5 月初', () => {
      // 当地 2026-04-30 22:30 EDT -> 22:30 - (-4h) = 26:30 = 次日 02:30 UTC (2026-05-01 02:30Z)
      const res = mapLocal('2026-04-30 22:30', NEW_YORK_SEGMENTS);
      expect(res.status).toBe('NORMAL');
      expect(res.candidatesUtc).toEqual(['2026-05-01T02:30:00Z']);
      expect(projectUtc('2026-05-01T02:30:00Z', NEW_YORK_SEGMENTS)).toBe('2026-04-30 22:30');
    });

    it('大月 31 天向小月 30 天跨月（东京 +540min）：8 月底跨至 9 月初', () => {
      // 当地 2026-09-01 03:15 JST -> 03:15 - 9h = 前一天 18:15 UTC (2026-08-31 18:15Z)
      const res = mapLocal('2026-09-01 03:15', TOKYO_SEGMENTS);
      expect(res.status).toBe('NORMAL');
      expect(res.candidatesUtc).toEqual(['2026-08-31T18:15:00Z']);
      expect(projectUtc('2026-08-31T18:15:00Z', TOKYO_SEGMENTS)).toBe('2026-09-01 03:15');
    });

    it('跨年交界换算（纽约 -300min）：2026 年底跨至 2027 年初', () => {
      // 当地 2026-12-31 20:00 EST -> 20:00 + 5h = 2027-01-01 01:00Z
      const res = mapLocal('2026-12-31 20:00', NEW_YORK_SEGMENTS);
      expect(res.status).toBe('NORMAL');
      expect(res.candidatesUtc).toEqual(['2027-01-01T01:00:00Z']);
      expect(projectUtc('2027-01-01T01:00:00Z', NEW_YORK_SEGMENTS)).toBe('2026-12-31 20:00');
    });
  });

  describe('超两候选异常 E_AMBIGUITY_GT2 与非法输入防御', () => {
    it('自定义多重重叠分段表：生成 3 个合法 UTC 候选时必须抛出 E_AMBIGUITY_GT2', () => {
      // 构造全覆盖 [ZONE_START_UTC, ZONE_END_UTC) 的分段表，其中在 2026-06-01 有三段重叠折返：
      // 当地时间 2026-06-01 10:00:
      // 段 1: [2026-06-01T06:00:00Z, 2026-06-01T07:30:00Z), offset +180 -> candidate = 10:00 - 180min = 07:00Z (在段内)
      // 段 2: [2026-06-01T07:30:00Z, 2026-06-01T08:30:00Z), offset +120 -> candidate = 10:00 - 120min = 08:00Z (在段内)
      // 段 3: [2026-06-01T08:30:00Z, 2026-06-01T10:00:00Z), offset +60  -> candidate = 10:00 - 60min  = 09:00Z (在段内)
      const ambiguousSegments: ZoneSegment[] = [
        {
          startUtc: ZONE_START_UTC,
          endUtc: '2026-06-01T06:00:00Z',
          offsetMinutes: 0,
        },
        {
          startUtc: '2026-06-01T06:00:00Z',
          endUtc: '2026-06-01T07:30:00Z',
          offsetMinutes: 180,
        },
        {
          startUtc: '2026-06-01T07:30:00Z',
          endUtc: '2026-06-01T08:30:00Z',
          offsetMinutes: 120,
        },
        {
          startUtc: '2026-06-01T08:30:00Z',
          endUtc: '2026-06-01T10:00:00Z',
          offsetMinutes: 60,
        },
        {
          startUtc: '2026-06-01T10:00:00Z',
          endUtc: ZONE_END_UTC,
          offsetMinutes: 300,
        },
      ];

      expect(() => mapLocal('2026-06-01 10:00', ambiguousSegments)).toThrow(
        TimeFoldError
      );

      try {
        mapLocal('2026-06-01 10:00', ambiguousSegments);
        expect.unreachable('Should have thrown E_AMBIGUITY_GT2');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        const tfErr = err as TimeFoldError;
        expect(tfErr.code).toBe('E_AMBIGUITY_GT2');
        expect(tfErr.path).toBe('requestedLocal');
        expect(tfErr.message).toContain('3 candidates');
      }
    });

    it('findCandidateUtcMinutes: 超过两候选同样抛出 E_AMBIGUITY_GT2', () => {
      const segs: ZoneSegment[] = [
        {
          startUtc: ZONE_START_UTC,
          endUtc: '2026-06-01T06:00:00Z',
          offsetMinutes: 0,
        },
        {
          startUtc: '2026-06-01T06:00:00Z',
          endUtc: '2026-06-01T07:30:00Z',
          offsetMinutes: 180,
        },
        {
          startUtc: '2026-06-01T07:30:00Z',
          endUtc: '2026-06-01T08:30:00Z',
          offsetMinutes: 120,
        },
        {
          startUtc: '2026-06-01T08:30:00Z',
          endUtc: '2026-06-01T10:00:00Z',
          offsetMinutes: 60,
        },
        {
          startUtc: '2026-06-01T10:00:00Z',
          endUtc: ZONE_END_UTC,
          offsetMinutes: 300,
        },
      ];

      const localMin = parseLocalMinute('2026-06-01 10:00');
      expect(() => findCandidateUtcMinutes(localMin, segs)).toThrow(TimeFoldError);
      try {
        findCandidateUtcMinutes(localMin, segs);
      } catch (err) {
        expect((err as TimeFoldError).code).toBe('E_AMBIGUITY_GT2');
      }
    });

    it('非法日期格式拒绝并抛出带有字段 path 的 TimeFoldError', () => {
      expect(() => mapLocal('not-a-date', TOKYO_SEGMENTS)).toThrow(TimeFoldError);
      try {
        mapLocal('not-a-date', TOKYO_SEGMENTS);
      } catch (err) {
        expect((err as TimeFoldError).code).toBe('E_INVALID_LOCAL_FORMAT');
        expect((err as TimeFoldError).path).toBe('requestedLocal');
      }

      // 包含秒数也是非法的
      expect(() => mapLocal('2026-06-01 09:00:00', TOKYO_SEGMENTS)).toThrow(
        TimeFoldError
      );

      // 非法月份
      expect(() => mapLocal('2026-13-01 09:00', TOKYO_SEGMENTS)).toThrow(
        TimeFoldError
      );

      // 非法日（2026 平年 2 月没有 29 日）
      expect(() => mapLocal('2026-02-29 09:00', TOKYO_SEGMENTS)).toThrow(
        TimeFoldError
      );

      // 非法小时
      expect(() => mapLocal('2026-06-01 24:00', TOKYO_SEGMENTS)).toThrow(
        TimeFoldError
      );
    });

    it('空分段数组拒绝抛出 E_SEGMENT_COUNT', () => {
      expect(() => mapLocal('2026-06-01 09:00', [])).toThrow(TimeFoldError);
      try {
        mapLocal('2026-06-01 09:00', []);
      } catch (err) {
        expect((err as TimeFoldError).code).toBe('E_SEGMENT_COUNT');
      }

      expect(() => projectUtc('2026-06-01T00:00:00Z', [])).toThrow(TimeFoldError);
    });
  });

  describe('projectUtc 投影与纯数学无状态特性', () => {
    it('支持数字分钟与 ISO 字符串两种重载输入', () => {
      const min = parseUtcMinute('2026-06-01T00:00:00Z');
      expect(projectUtc(min, TOKYO_SEGMENTS)).toBe('2026-06-01 09:00');
      expect(projectUtc('2026-06-01T00:00:00Z', TOKYO_SEGMENTS)).toBe('2026-06-01 09:00');
    });

    it('分段范围外 instant 抛出 E_OUT_OF_BOUNDS', () => {
      expect(() => projectUtc('2025-01-01T00:00:00Z', TOKYO_SEGMENTS)).toThrow(
        TimeFoldError
      );
      try {
        projectUtc('2025-01-01T00:00:00Z', TOKYO_SEGMENTS);
      } catch (err) {
        expect((err as TimeFoldError).code).toBe('E_OUT_OF_BOUNDS');
        expect((err as TimeFoldError).path).toBe('instantMin');
      }
    });

    it('非硬编码验证：同一时刻在不同时区产出不同映射结果', () => {
      const nyRes = mapLocal('2026-06-01 12:00', NEW_YORK_SEGMENTS);
      const ldRes = mapLocal('2026-06-01 12:00', LONDON_SEGMENTS);
      const tkRes = mapLocal('2026-06-01 12:00', TOKYO_SEGMENTS);

      expect(nyRes.candidatesUtc[0]).toBe('2026-06-01T16:00:00Z'); // EDT -4h
      expect(ldRes.candidatesUtc[0]).toBe('2026-06-01T11:00:00Z'); // BST +1h
      expect(tkRes.candidatesUtc[0]).toBe('2026-06-01T03:00:00Z'); // JST +9h

      expect(nyRes.candidatesUtc[0]).not.toBe(ldRes.candidatesUtc[0]);
      expect(ldRes.candidatesUtc[0]).not.toBe(tkRes.candidatesUtc[0]);
    });
  });
});
