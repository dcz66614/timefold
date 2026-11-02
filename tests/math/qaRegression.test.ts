/**
 * P009-T015 独立 QA 数学全量回归与不变量复核测试
 *
 * 严格遵从 PROJECT_BOOK.md §8 (MATH01–MATH10) 与 IMPLEMENTATION_PLAN.md §5 T015、TASK-P009-T015。
 *
 * 独立性原则：
 * 1. 作为外部 QA 独立测试，不自证、不复用被测函数的内部映射逻辑作为预期值；
 * 2. 覆盖 MATH01–MATH10 的每一个门槛与边界条件；
 * 3. 严格断言黄金测试值、错误码与数学不变量。
 */

import { describe, expect, it } from 'vitest';
import {
  NEW_YORK_SEGMENTS,
  LONDON_SEGMENTS,
  TOKYO_SEGMENTS,
  UTC_SEGMENTS,
  ZONE_START_UTC,
  ZONE_END_UTC,
} from '../../src/core/zones';
import {
  validateZoneSegments,
  validateInput,
} from '../../src/core/validate';
import { mapLocal, projectUtc } from '../../src/core/map';
import { analyze } from '../../src/core/analyze';
import { resolveMapping } from '../../src/core/recurrence';
import {
  PRESET_TF_A,
  PRESET_TF_B,
  PRESET_TF_C,
  PRESET_TF_D,
  PRESET_TF_E,
  PRESET_TF_F,
  PRESETS,
  clonePresetInput,
} from '../../src/data/presets';
import {
  TimeFoldError,
  type TimeFoldInput,
  type ZoneSegment,
} from '../../src/core/types';
import { exportTimeFold, parseTimeFoldJson, importAndAnalyze } from '../../src/io/json';

/** QA 独立解析民用本地时间为整数分钟 */
function qaParseCivilLocal(str: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(str);
  if (!match) throw new Error(`QA invalid civil local string: ${str}`);
  return Math.floor(
    Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!, +match[4]!, +match[5]!) / 60000
  );
}

/** QA 独立解析 ISO UTC 为整数分钟 */
function qaParseIsoUtc(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(iso);
  if (!match) throw new Error(`QA invalid ISO UTC string: ${iso}`);
  return Math.floor(
    Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!, +match[4]!, +match[5]!) / 60000
  );
}

/** QA 独立格式化整数 UTC 分钟为 ISO 字符串 */
function qaFormatIsoUtc(min: number): string {
  return new Date(min * 60000).toISOString().slice(0, 19) + 'Z';
}

/**
 * QA 独立暴力量测 Oracle：
 * 在整个 [-14h, +12h] 时间窗内逐分扫描 UTC 实例，
 * 判定落在半开区间 [start, end) 的 offset 使得 t + offset === L*。
 */
function qaBruteForceOracle(
  localStr: string,
  segments: readonly ZoneSegment[]
): {
  status: 'NORMAL' | 'FOLD' | 'GAP';
  candidatesUtc: string[];
  gapBoundaryUtc: string | null;
} {
  const targetMin = qaParseCivilLocal(localStr);
  const parsedSegs = segments.map((s) => ({
    startMin: qaParseIsoUtc(s.startUtc),
    endMin: qaParseIsoUtc(s.endUtc),
    offsetMinutes: s.offsetMinutes,
    startUtc: s.startUtc,
  }));

  const candidates: number[] = [];
  // 扫描窗口：UTC 分钟范围
  const scanStart = targetMin - 840 - 120;
  const scanEnd = targetMin + 720 + 120;

  for (let t = scanStart; t <= scanEnd; t++) {
    for (const seg of parsedSegs) {
      if (t >= seg.startMin && t < seg.endMin) {
        if (t + seg.offsetMinutes === targetMin) {
          candidates.push(t);
        }
        break;
      }
    }
  }

  candidates.sort((a, b) => a - b);
  const candidatesUtc = candidates.map(qaFormatIsoUtc);

  if (candidates.length === 1) {
    return {
      status: 'NORMAL',
      candidatesUtc,
      gapBoundaryUtc: null,
    };
  }
  if (candidates.length === 2) {
    return {
      status: 'FOLD',
      candidatesUtc,
      gapBoundaryUtc: null,
    };
  }
  if (candidates.length === 0) {
    // 识别跳变边界
    let boundaryUtc: string | null = null;
    for (let i = 0; i < parsedSegs.length - 1; i++) {
      const cur = parsedSegs[i]!;
      const next = parsedSegs[i + 1]!;
      if (next.offsetMinutes > cur.offsetMinutes) {
        const gapStartLocal = cur.endMin + cur.offsetMinutes;
        const gapEndLocal = next.startMin + next.offsetMinutes;
        if (targetMin >= gapStartLocal && targetMin < gapEndLocal) {
          boundaryUtc = next.startUtc;
          break;
        }
      }
    }
    return {
      status: 'GAP',
      candidatesUtc: [],
      gapBoundaryUtc: boundaryUtc,
    };
  }

  throw new Error(`Unexpected candidate count: ${candidates.length}`);
}

/** 辅助函数：深度递归冻结对象 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && (typeof val === 'object' || typeof val === 'function')) {
      deepFreeze(val);
    }
  }
  return obj;
}

describe('P009-T015 QA 独立数学全量复核 (MATH01–MATH10)', () => {
  /* ========================================================================
   * MATH01: 分段全覆盖、相邻边界半开、整数 offset；非法重叠/缺口拒绝
   * ======================================================================== */
  describe('MATH01: 分段全覆盖与边界有效性检验', () => {
    it('官方四套冻结分段 (Tokyo, NY, London, UTC) 均成功通过验证', () => {
      expect(() => validateZoneSegments(TOKYO_SEGMENTS)).not.toThrow();
      expect(() => validateZoneSegments(NEW_YORK_SEGMENTS)).not.toThrow();
      expect(() => validateZoneSegments(LONDON_SEGMENTS)).not.toThrow();
      expect(() => validateZoneSegments(UTC_SEGMENTS)).not.toThrow();
    });

    it('分段必须覆盖 [2025-12-30T00:00:00Z, 2027-01-03T00:00:00Z)', () => {
      const validTokyo = validateZoneSegments(TOKYO_SEGMENTS);
      expect(validTokyo[0]!.startUtc).toBe(ZONE_START_UTC);
      expect(validTokyo[validTokyo.length - 1]!.endUtc).toBe(ZONE_END_UTC);

      // 第一段起点不对
      const badStart = [
        {
          startUtc: '2026-01-01T00:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: 0,
        },
      ];
      expect(() => validateZoneSegments(badStart)).toThrowError(
        expect.objectContaining({ code: 'E_SEGMENT_COVERAGE' })
      );

      // 最后一段终点不对
      const badEnd = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2026-12-31T00:00:00Z',
          offsetMinutes: 0,
        },
      ];
      expect(() => validateZoneSegments(badEnd)).toThrowError(
        expect.objectContaining({ code: 'E_SEGMENT_COVERAGE' })
      );
    });

    it('刻意空洞 (Segment Gap) 命中 E_SEGMENT_GAP 拒绝', () => {
      const segmentsWithGap = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2026-06-01T00:00:00Z',
          offsetMinutes: 0,
        },
        {
          startUtc: '2026-06-01T01:00:00Z', // 存在 1 小时空洞
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: 60,
        },
      ];
      expect(() => validateZoneSegments(segmentsWithGap)).toThrowError(
        expect.objectContaining({ code: 'E_SEGMENT_GAP' })
      );
    });

    it('刻意重叠 (Segment Overlap) 命中 E_SEGMENT_OVERLAP 拒绝', () => {
      const segmentsWithOverlap = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2026-06-01T02:00:00Z',
          offsetMinutes: 0,
        },
        {
          startUtc: '2026-06-01T01:00:00Z', // 重叠 1 小时
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: 60,
        },
      ];
      expect(() => validateZoneSegments(segmentsWithOverlap)).toThrowError(
        expect.objectContaining({ code: 'E_SEGMENT_OVERLAP' })
      );
    });

    it('相邻段相同偏移命中 E_REDUNDANT_SEGMENT 拒绝', () => {
      const segmentsSameOffset = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2026-06-01T00:00:00Z',
          offsetMinutes: 60,
        },
        {
          startUtc: '2026-06-01T00:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: 60, // 相同偏移
        },
      ];
      expect(() => validateZoneSegments(segmentsSameOffset)).toThrowError(
        expect.objectContaining({ code: 'E_REDUNDANT_SEGMENT' })
      );
    });

    it('分段数超过 16 段命中 E_SEGMENT_COUNT 拒绝', () => {
      // 构造 17 个有效连接但数量超标的分段
      const segs: ZoneSegment[] = [];
      const totalMinutes = 531360; // 369 days in minutes
      const step = Math.floor(totalMinutes / 17);
      const startMin = qaParseIsoUtc(ZONE_START_UTC);
      let cur = startMin;
      for (let i = 0; i < 17; i++) {
        const next = i === 16 ? qaParseIsoUtc(ZONE_END_UTC) : cur + step;
        const dStart = new Date(cur * 60000).toISOString().slice(0, 19) + 'Z';
        const dEnd = new Date(next * 60000).toISOString().slice(0, 19) + 'Z';
        segs.push({
          startUtc: dStart,
          endUtc: dEnd,
          offsetMinutes: (i % 2 === 0 ? 0 : 60),
        });
        cur = next;
      }
      expect(segs.length).toBe(17);
      expect(() => validateZoneSegments(segs)).toThrowError(
        expect.objectContaining({ code: 'E_SEGMENT_COUNT' })
      );
    });

    it('段内 startUtc >= endUtc 命中 E_INVALID_SEGMENT_BOUNDS 拒绝', () => {
      const badBounds = [
        {
          startUtc: '2026-01-01T12:00:00Z',
          endUtc: '2026-01-01T12:00:00Z',
          offsetMinutes: 0,
        },
      ];
      expect(() => validateZoneSegments(badBounds)).toThrowError(
        expect.objectContaining({ code: 'E_INVALID_SEGMENT_BOUNDS' })
      );
    });

    it('非整数或越界 offsetMinutes 命中 E_OFFSET_OUT_OF_RANGE 拒绝', () => {
      const floatOffset = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: 60.5,
        },
      ];
      expect(() => validateZoneSegments(floatOffset)).toThrowError(
        expect.objectContaining({ code: 'E_OFFSET_OUT_OF_RANGE' })
      );

      const tooSmall = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: -721,
        },
      ];
      expect(() => validateZoneSegments(tooSmall)).toThrowError(
        expect.objectContaining({ code: 'E_OFFSET_OUT_OF_RANGE' })
      );

      const tooLarge = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: 841,
        },
      ];
      expect(() => validateZoneSegments(tooLarge)).toThrowError(
        expect.objectContaining({ code: 'E_OFFSET_OUT_OF_RANGE' })
      );
    });
  });

  /* ========================================================================
   * MATH02: Tokyo 2026-06-01 09:00 唯一 UTC 2026-06-01T00:00:00Z
   * ======================================================================== */
  describe('MATH02: Tokyo 唯一反像精确断言', () => {
    it('Tokyo 2026-06-01 09:00 映射候选数必须为 1 且精确等于 2026-06-01T00:00:00Z', () => {
      const cand = mapLocal('2026-06-01 09:00', TOKYO_SEGMENTS);
      expect(cand.status).toBe('NORMAL');
      expect(cand.candidatesUtc).toHaveLength(1);
      expect(cand.candidatesUtc[0]).toBe('2026-06-01T00:00:00Z');

      const resolved = resolveMapping(cand, { gap: 'skip', fold: 'earlier' }, TOKYO_SEGMENTS);
      expect(resolved.selectedUtc).toEqual(['2026-06-01T00:00:00Z']);
      expect(resolved.realizedLocal).toEqual(['2026-06-01 09:00']);
    });

    it('TF-E 预设完整求解命中唯一反像 (3 日均为 00:00Z)', () => {
      const out = analyze(PRESET_TF_E);
      expect(out.occurrences).toHaveLength(3);
      const occ0 = out.occurrences[0]!;
      expect(occ0.requestedLocal).toBe('2026-06-01 09:00');
      expect(occ0.status).toBe('NORMAL');
      expect(occ0.candidatesUtc).toEqual(['2026-06-01T00:00:00Z']);
      expect(occ0.selectedUtc).toEqual(['2026-06-01T00:00:00Z']);
      expect(occ0.realizedLocal).toEqual(['2026-06-01 09:00']);
      expect(out.firstWitness?.type).toBe('NONE');
    });
  });

  /* ========================================================================
   * MATH03: New York 2026-03-08 02:30 反像空集 (Spring Gap)
   * ======================================================================== */
  describe('MATH03: New York 春季跳时缺口 (GAP) 断言', () => {
    it('New York 2026-03-08 02:30 映射候选数必须为 0 且状态为 GAP', () => {
      const cand = mapLocal('2026-03-08 02:30', NEW_YORK_SEGMENTS);
      expect(cand.status).toBe('GAP');
      expect(cand.candidatesUtc).toHaveLength(0);
      expect(cand.gapBoundaryUtc).toBe('2026-03-08T07:00:00Z');

      const resolved = resolveMapping(cand, { gap: 'skip', fold: 'earlier' }, NEW_YORK_SEGMENTS);
      expect(resolved.selectedUtc).toHaveLength(0);
      expect(resolved.realizedLocal).toHaveLength(0);
    });

    it('New York 春季跳变边界前后一分钟微观检验', () => {
      // 01:59 为跳变前最后一分钟：NORMAL，offset -300 -> 06:59Z
      const m0159 = mapLocal('2026-03-08 01:59', NEW_YORK_SEGMENTS);
      expect(m0159.status).toBe('NORMAL');
      expect(m0159.candidatesUtc).toEqual(['2026-03-08T06:59:00Z']);

      // 02:00 为空洞起点：GAP
      const m0200 = mapLocal('2026-03-08 02:00', NEW_YORK_SEGMENTS);
      expect(m0200.status).toBe('GAP');
      expect(m0200.candidatesUtc).toHaveLength(0);

      // 02:59 为空洞末分钟：GAP
      const m0259 = mapLocal('2026-03-08 02:59', NEW_YORK_SEGMENTS);
      expect(m0259.status).toBe('GAP');
      expect(m0259.candidatesUtc).toHaveLength(0);

      // 03:00 为跳变后首分钟：NORMAL，offset -240 -> 07:00Z
      const m0300 = mapLocal('2026-03-08 03:00', NEW_YORK_SEGMENTS);
      expect(m0300.status).toBe('NORMAL');
      expect(m0300.candidatesUtc).toEqual(['2026-03-08T07:00:00Z']);
    });
  });

  /* ========================================================================
   * MATH04: New York 2026-11-01 01:30 两候选 (Fall Fold)
   * ======================================================================== */
  describe('MATH04: New York 秋季折返重叠 (FOLD) 断言', () => {
    it('New York 2026-11-01 01:30 候选精确为 05:30Z 与 06:30Z，严格升序且相差 60 分钟', () => {
      const res = mapLocal('2026-11-01 01:30', NEW_YORK_SEGMENTS);
      expect(res.status).toBe('FOLD');
      expect(res.candidatesUtc).toHaveLength(2);
      expect(res.candidatesUtc).toEqual(['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z']);

      const min0 = qaParseIsoUtc(res.candidatesUtc[0]!);
      const min1 = qaParseIsoUtc(res.candidatesUtc[1]!);
      expect(min1 - min0).toBe(60);
      expect(min0).toBeLessThan(min1);
    });

    it('New York 秋季折返边界微观检验', () => {
      // 00:59 为折返前：NORMAL，offset -240 -> 04:59Z
      const m0059 = mapLocal('2026-11-01 00:59', NEW_YORK_SEGMENTS);
      expect(m0059.status).toBe('NORMAL');
      expect(m0059.candidatesUtc).toEqual(['2026-11-01T04:59:00Z']);

      // 01:00 为折返首分钟：FOLD (05:00Z, 06:00Z)
      const m0100 = mapLocal('2026-11-01 01:00', NEW_YORK_SEGMENTS);
      expect(m0100.status).toBe('FOLD');
      expect(m0100.candidatesUtc).toEqual(['2026-11-01T05:00:00Z', '2026-11-01T06:00:00Z']);

      // 01:59 为折返末分钟：FOLD (05:59Z, 06:59Z)
      const m0159 = mapLocal('2026-11-01 01:59', NEW_YORK_SEGMENTS);
      expect(m0159.status).toBe('FOLD');
      expect(m0159.candidatesUtc).toEqual(['2026-11-01T05:59:00Z', '2026-11-01T06:59:00Z']);

      // 02:00 退出折返：NORMAL，offset -300 -> 07:00Z
      const m0200 = mapLocal('2026-11-01 02:00', NEW_YORK_SEGMENTS);
      expect(m0200.status).toBe('NORMAL');
      expect(m0200.candidatesUtc).toEqual(['2026-11-01T07:00:00Z']);
    });
  });

  /* ========================================================================
   * MATH05: London 2026-03-29 01:30 反像空集 (Spring Gap)
   * ======================================================================== */
  describe('MATH05: London 春季跳时缺口 (GAP) 断言', () => {
    it('London 2026-03-29 01:30 候选 0，状态 GAP，跳变边界 2026-03-29T01:00:00Z', () => {
      const res = mapLocal('2026-03-29 01:30', LONDON_SEGMENTS);
      expect(res.status).toBe('GAP');
      expect(res.candidatesUtc).toHaveLength(0);
      expect(res.gapBoundaryUtc).toBe('2026-03-29T01:00:00Z');
    });

    it('London 春季边界微观检验', () => {
      // 00:59: NORMAL (00:59Z, offset 0)
      const m0059 = mapLocal('2026-03-29 00:59', LONDON_SEGMENTS);
      expect(m0059.status).toBe('NORMAL');
      expect(m0059.candidatesUtc).toEqual(['2026-03-29T00:59:00Z']);

      // 01:00: GAP
      const m0100 = mapLocal('2026-03-29 01:00', LONDON_SEGMENTS);
      expect(m0100.status).toBe('GAP');
      expect(m0100.candidatesUtc).toHaveLength(0);

      // 01:59: GAP
      const m0159 = mapLocal('2026-03-29 01:59', LONDON_SEGMENTS);
      expect(m0159.status).toBe('GAP');
      expect(m0159.candidatesUtc).toHaveLength(0);

      // 02:00: NORMAL (01:00Z, offset +60)
      const m0200 = mapLocal('2026-03-29 02:00', LONDON_SEGMENTS);
      expect(m0200.status).toBe('NORMAL');
      expect(m0200.candidatesUtc).toEqual(['2026-03-29T01:00:00Z']);
    });
  });

  /* ========================================================================
   * MATH06: London 2026-10-25 01:30 两候选 (Fall Fold)
   * ======================================================================== */
  describe('MATH06: London 秋季折返重叠 (FOLD) 断言', () => {
    it('London 2026-10-25 01:30 候选精确为 00:30Z 与 01:30Z，严格升序且相差 60 分钟', () => {
      const res = mapLocal('2026-10-25 01:30', LONDON_SEGMENTS);
      expect(res.status).toBe('FOLD');
      expect(res.candidatesUtc).toEqual(['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']);
    });

    it('London 秋季边界微观检验', () => {
      // 00:59: NORMAL (23:59Z 前一日, offset +60)
      const m0059 = mapLocal('2026-10-25 00:59', LONDON_SEGMENTS);
      expect(m0059.status).toBe('NORMAL');
      expect(m0059.candidatesUtc).toEqual(['2026-10-24T23:59:00Z']);

      // 01:00: FOLD (00:00Z, 01:00Z)
      const m0100 = mapLocal('2026-10-25 01:00', LONDON_SEGMENTS);
      expect(m0100.status).toBe('FOLD');
      expect(m0100.candidatesUtc).toEqual(['2026-10-25T00:00:00Z', '2026-10-25T01:00:00Z']);

      // 01:59: FOLD (00:59Z, 01:59Z)
      const m0159 = mapLocal('2026-10-25 01:59', LONDON_SEGMENTS);
      expect(m0159.status).toBe('FOLD');
      expect(m0159.candidatesUtc).toEqual(['2026-10-25T00:59:00Z', '2026-10-25T01:59:00Z']);

      // 02:00: NORMAL (02:00Z, offset 0)
      const m0200 = mapLocal('2026-10-25 02:00', LONDON_SEGMENTS);
      expect(m0200.status).toBe('NORMAL');
      expect(m0200.candidatesUtc).toEqual(['2026-10-25T02:00:00Z']);
    });
  });

  /* ========================================================================
   * MATH07: 策略生效验证 (gap: skip/shiftForward; fold: earlier/later/both)
   * ======================================================================== */
  describe('MATH07: 策略行为与 candidates 不变性检验', () => {
    it('TF-A: gap skip 产生 0 选中，shiftForward 产生 07:00Z / 03:00 local', () => {
      const candA = mapLocal('2026-03-08 02:30', NEW_YORK_SEGMENTS);
      // skip
      const skipA = resolveMapping(candA, { gap: 'skip', fold: 'earlier' }, NEW_YORK_SEGMENTS);
      expect(skipA.status).toBe('GAP');
      expect(skipA.candidatesUtc).toEqual([]);
      expect(skipA.selectedUtc).toEqual([]);
      expect(skipA.realizedLocal).toEqual([]);

      // shiftForward
      const shiftA = resolveMapping(candA, { gap: 'shiftForward', fold: 'earlier' }, NEW_YORK_SEGMENTS);
      expect(shiftA.status).toBe('GAP');
      expect(shiftA.candidatesUtc).toEqual([]); // 候选集始终为空
      expect(shiftA.selectedUtc).toEqual(['2026-03-08T07:00:00Z']);
      expect(shiftA.realizedLocal).toEqual(['2026-03-08 03:00']);
    });

    it('TF-C: gap skip 产生 0 选中，shiftForward 产生 01:00Z / 02:00 local', () => {
      const candC = mapLocal('2026-03-29 01:30', LONDON_SEGMENTS);
      // skip
      const skipC = resolveMapping(candC, { gap: 'skip', fold: 'earlier' }, LONDON_SEGMENTS);
      expect(skipC.status).toBe('GAP');
      expect(skipC.selectedUtc).toEqual([]);

      // shiftForward
      const shiftC = resolveMapping(candC, { gap: 'shiftForward', fold: 'earlier' }, LONDON_SEGMENTS);
      expect(shiftC.status).toBe('GAP');
      expect(shiftC.candidatesUtc).toEqual([]);
      expect(shiftC.selectedUtc).toEqual(['2026-03-29T01:00:00Z']);
      expect(shiftC.realizedLocal).toEqual(['2026-03-29 02:00']);
    });

    it('TF-B: earlier/later/both 分别选中 1/1/2 项，且 candidate 集严格不变', () => {
      const candB = mapLocal('2026-11-01 01:30', NEW_YORK_SEGMENTS);
      const earlier = resolveMapping(candB, { gap: 'skip', fold: 'earlier' }, NEW_YORK_SEGMENTS);
      const later = resolveMapping(candB, { gap: 'skip', fold: 'later' }, NEW_YORK_SEGMENTS);
      const both = resolveMapping(candB, { gap: 'skip', fold: 'both' }, NEW_YORK_SEGMENTS);

      // candidates 必须全部相同
      const expectedCandidates = ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'];
      expect(earlier.candidatesUtc).toEqual(expectedCandidates);
      expect(later.candidatesUtc).toEqual(expectedCandidates);
      expect(both.candidatesUtc).toEqual(expectedCandidates);

      // selectedUtc 断言
      expect(earlier.selectedUtc).toEqual(['2026-11-01T05:30:00Z']);
      expect(later.selectedUtc).toEqual(['2026-11-01T06:30:00Z']);
      expect(both.selectedUtc).toEqual(expectedCandidates);
    });
  });

  /* ========================================================================
   * MATH08: 固定本地周期与固定绝对周期偏差 (TF-F)
   * ======================================================================== */
  describe('MATH08: 固定绝对周期与基线漂移精确断言 (TF-F)', () => {
    it('TF-F 产生正确的 [14, 13, 13, 13] UTC hours，基线 [14, 14, 14, 14]，首个见证 2026-03-09 +60min', () => {
      const res = analyze(PRESET_TF_F);
      expect(res.occurrences).toHaveLength(4);

      // 提取选中的 UTC 小时
      const actualUtcHours = res.occurrences.map((occ) => {
        const utcStr = occ.selectedUtc[0]!;
        return Number(utcStr.slice(11, 13));
      });
      expect(actualUtcHours).toEqual([14, 13, 13, 13]);

      // 提取基线 UTC 小时
      const baselineUtcHours = res.occurrences.map((occ) => {
        const utcStr = occ.baselineUtc!;
        return Number(utcStr.slice(11, 13));
      });
      expect(baselineUtcHours).toEqual([14, 14, 14, 14]);

      // 逐周漂移分钟断言
      const drifts = res.occurrences.map((occ) => occ.driftMinutes);
      expect(drifts).toEqual([0, 60, 60, 60]);

      // 首个见证断言
      expect(res.firstWitness).not.toBeNull();
      expect(res.firstWitness?.type).toBe('DRIFT');
      expect(res.firstWitness?.date).toBe('2026-03-09');
      expect(res.firstWitness?.boundaryUtc).toBe('2026-03-08T07:00:00Z');
      expect(res.firstWitness?.mapping?.driftMinutes).toBe(60);
    });
  });

  /* ========================================================================
   * MATH09: 与独立 Oracle 交叉检验 (50 个冻结样本)
   * ======================================================================== */
  describe('MATH09: 独立暴力 Oracle 与 SUT 映射一致性验证', () => {
    // 50 个冻结样本：涵盖 4 快照跳变边界、常态日、月末、年末
    const testSamples: { label: string; segments: readonly ZoneSegment[]; localStr: string }[] = [
      // Tokyo 样本 (SMP-01 .. SMP-08)
      { label: 'Tokyo-01', segments: TOKYO_SEGMENTS, localStr: '2026-01-01 00:00' },
      { label: 'Tokyo-02', segments: TOKYO_SEGMENTS, localStr: '2026-02-28 23:59' },
      { label: 'Tokyo-03', segments: TOKYO_SEGMENTS, localStr: '2026-06-01 09:00' },
      { label: 'Tokyo-04', segments: TOKYO_SEGMENTS, localStr: '2026-07-15 12:00' },
      { label: 'Tokyo-05', segments: TOKYO_SEGMENTS, localStr: '2026-08-31 18:30' },
      { label: 'Tokyo-06', segments: TOKYO_SEGMENTS, localStr: '2026-10-01 04:15' },
      { label: 'Tokyo-07', segments: TOKYO_SEGMENTS, localStr: '2026-11-11 11:11' },
      { label: 'Tokyo-08', segments: TOKYO_SEGMENTS, localStr: '2026-12-31 23:59' },

      // New York 春季跳时样本 (SMP-09 .. SMP-18)
      { label: 'NY-Spring-01', segments: NEW_YORK_SEGMENTS, localStr: '2026-03-08 01:58' },
      { label: 'NY-Spring-02', segments: NEW_YORK_SEGMENTS, localStr: '2026-03-08 01:59' },
      { label: 'NY-Spring-03', segments: NEW_YORK_SEGMENTS, localStr: '2026-03-08 02:00' }, // GAP
      { label: 'NY-Spring-04', segments: NEW_YORK_SEGMENTS, localStr: '2026-03-08 02:15' }, // GAP
      { label: 'NY-Spring-05', segments: NEW_YORK_SEGMENTS, localStr: '2026-03-08 02:30' }, // GAP
      { label: 'NY-Spring-06', segments: NEW_YORK_SEGMENTS, localStr: '2026-03-08 02:45' }, // GAP
      { label: 'NY-Spring-07', segments: NEW_YORK_SEGMENTS, localStr: '2026-03-08 02:59' }, // GAP
      { label: 'NY-Spring-08', segments: NEW_YORK_SEGMENTS, localStr: '2026-03-08 03:00' }, // NORMAL
      { label: 'NY-Spring-09', segments: NEW_YORK_SEGMENTS, localStr: '2026-03-08 03:01' },
      { label: 'NY-Spring-10', segments: NEW_YORK_SEGMENTS, localStr: '2026-03-08 12:00' },

      // New York 秋季折返样本 (SMP-19 .. SMP-28)
      { label: 'NY-Fall-01', segments: NEW_YORK_SEGMENTS, localStr: '2026-11-01 00:58' },
      { label: 'NY-Fall-02', segments: NEW_YORK_SEGMENTS, localStr: '2026-11-01 00:59' },
      { label: 'NY-Fall-03', segments: NEW_YORK_SEGMENTS, localStr: '2026-11-01 01:00' }, // FOLD
      { label: 'NY-Fall-04', segments: NEW_YORK_SEGMENTS, localStr: '2026-11-01 01:15' }, // FOLD
      { label: 'NY-Fall-05', segments: NEW_YORK_SEGMENTS, localStr: '2026-11-01 01:30' }, // FOLD
      { label: 'NY-Fall-06', segments: NEW_YORK_SEGMENTS, localStr: '2026-11-01 01:45' }, // FOLD
      { label: 'NY-Fall-07', segments: NEW_YORK_SEGMENTS, localStr: '2026-11-01 01:59' }, // FOLD
      { label: 'NY-Fall-08', segments: NEW_YORK_SEGMENTS, localStr: '2026-11-01 02:00' }, // NORMAL
      { label: 'NY-Fall-09', segments: NEW_YORK_SEGMENTS, localStr: '2026-11-01 02:01' },
      { label: 'NY-Fall-10', segments: NEW_YORK_SEGMENTS, localStr: '2026-11-01 12:00' },

      // London 春季跳时样本 (SMP-29 .. SMP-38)
      { label: 'Lon-Spring-01', segments: LONDON_SEGMENTS, localStr: '2026-03-29 00:58' },
      { label: 'Lon-Spring-02', segments: LONDON_SEGMENTS, localStr: '2026-03-29 00:59' },
      { label: 'Lon-Spring-03', segments: LONDON_SEGMENTS, localStr: '2026-03-29 01:00' }, // GAP
      { label: 'Lon-Spring-04', segments: LONDON_SEGMENTS, localStr: '2026-03-29 01:15' }, // GAP
      { label: 'Lon-Spring-05', segments: LONDON_SEGMENTS, localStr: '2026-03-29 01:30' }, // GAP
      { label: 'Lon-Spring-06', segments: LONDON_SEGMENTS, localStr: '2026-03-29 01:45' }, // GAP
      { label: 'Lon-Spring-07', segments: LONDON_SEGMENTS, localStr: '2026-03-29 01:59' }, // GAP
      { label: 'Lon-Spring-08', segments: LONDON_SEGMENTS, localStr: '2026-03-29 02:00' }, // NORMAL
      { label: 'Lon-Spring-09', segments: LONDON_SEGMENTS, localStr: '2026-03-29 02:01' },
      { label: 'Lon-Spring-10', segments: LONDON_SEGMENTS, localStr: '2026-03-29 12:00' },

      // London 秋季折返样本 (SMP-39 .. SMP-46)
      { label: 'Lon-Fall-01', segments: LONDON_SEGMENTS, localStr: '2026-10-25 00:58' },
      { label: 'Lon-Fall-02', segments: LONDON_SEGMENTS, localStr: '2026-10-25 00:59' },
      { label: 'Lon-Fall-03', segments: LONDON_SEGMENTS, localStr: '2026-10-25 01:00' }, // FOLD
      { label: 'Lon-Fall-04', segments: LONDON_SEGMENTS, localStr: '2026-10-25 01:15' }, // FOLD
      { label: 'Lon-Fall-05', segments: LONDON_SEGMENTS, localStr: '2026-10-25 01:30' }, // FOLD
      { label: 'Lon-Fall-06', segments: LONDON_SEGMENTS, localStr: '2026-10-25 01:59' }, // FOLD
      { label: 'Lon-Fall-07', segments: LONDON_SEGMENTS, localStr: '2026-10-25 02:00' }, // NORMAL
      { label: 'Lon-Fall-08', segments: LONDON_SEGMENTS, localStr: '2026-10-25 12:00' },

      // UTC 样本 (SMP-47 .. SMP-50)
      { label: 'UTC-01', segments: UTC_SEGMENTS, localStr: '2026-01-01 00:00' },
      { label: 'UTC-02', segments: UTC_SEGMENTS, localStr: '2026-03-08 02:30' },
      { label: 'UTC-03', segments: UTC_SEGMENTS, localStr: '2026-10-25 01:30' },
      { label: 'UTC-04', segments: UTC_SEGMENTS, localStr: '2026-12-31 23:59' },
    ];

    it('50 个样本测试：样本总数严格等于 50', () => {
      expect(testSamples).toHaveLength(50);
    });

    it('50 个样本全部与独立 Oracle 暴力扫描完全一致（候选数、候选值、状态、跳变边界）', () => {
      for (const sample of testSamples) {
        const oracleRes = qaBruteForceOracle(sample.localStr, sample.segments);
        const sutRes = mapLocal(sample.localStr, sample.segments);

        expect(
          sutRes.status,
          `Sample ${sample.label} (${sample.localStr}) status mismatch`
        ).toBe(oracleRes.status);

        expect(
          sutRes.candidatesUtc,
          `Sample ${sample.label} (${sample.localStr}) candidatesUtc mismatch`
        ).toEqual(oracleRes.candidatesUtc);

        if (oracleRes.status === 'GAP') {
          expect(
            sutRes.gapBoundaryUtc,
            `Sample ${sample.label} (${sample.localStr}) gapBoundaryUtc mismatch`
          ).toBe(oracleRes.gapBoundaryUtc);
        }
      }
    });
  });

  /* ========================================================================
   * MATH10: 再现性与五大不变量检验
   * ======================================================================== */
  describe('MATH10: 再现性与数学不变量', () => {
    it('不变量 1: 六个预设重算深度一致 (多次重复运算输出完全恒等)', () => {
      for (const preset of PRESETS) {
        const first = analyze(preset.input);
        for (let i = 0; i < 5; i++) {
          const subsequent = analyze(preset.input);
          expect(subsequent).toEqual(first);
        }
      }
    });

    it('不变量 2: 导出 -> 导入 -> 重算输出完全一致 (Roundtrip Invariant)', () => {
      for (const preset of PRESETS) {
        const originalResult = analyze(preset.input);
        const exportedJson = exportTimeFold(preset.input, originalResult);
        const imported = importAndAnalyze(exportedJson);

        expect(imported.input).toEqual(preset.input);
        expect(imported.result).toEqual(originalResult);
      }
    });

    it('不变量 3: 候选反投不变量 (全部 candidate UTC 反投必须等于 requestedLocal)', () => {
      for (const preset of PRESETS) {
        const res = analyze(preset.input);
        for (const occ of res.occurrences) {
          for (const candUtc of occ.candidatesUtc) {
            const projectedLocal = projectUtc(candUtc, preset.input.zone.segments);
            expect(
              projectedLocal,
              `Candidate ${candUtc} projected local does not match requestedLocal ${occ.requestedLocal}`
            ).toBe(occ.requestedLocal);
          }
        }
      }
    });

    it('不变量 4: 输入冻结对象无变异 (Deep Freeze Immutability)', () => {
      for (const preset of PRESETS) {
        const cloned = clonePresetInput(preset.id);
        deepFreeze(cloned);
        // 执行 analyze 不应抛出 TypeError (can't add property / read-only)
        expect(() => analyze(cloned)).not.toThrow();
      }
    });

    it('不变量 5: runId 旧结果不污染新结果', () => {
      // 验证分析逻辑为无状态纯函数，输入输出完全确定
      const inputA = clonePresetInput('TF-A');
      const inputB = clonePresetInput('TF-B');
      const resA1 = analyze(inputA);
      const resB = analyze(inputB);
      const resA2 = analyze(inputA);

      expect(resA1).toEqual(resA2);
      expect(resA1).not.toEqual(resB);
    });
  });
});
