import { describe, it, expect } from 'vitest';
import { TimeFoldError, type TimeFoldInput } from '../../src/core/types';
import {
  ZONE_START_UTC,
  ZONE_END_UTC,
  ZONE_LABEL_NEW_YORK,
  ZONE_LABEL_LONDON,
  ZONE_LABEL_TOKYO,
  ZONE_LABEL_UTC,
  NEW_YORK_SEGMENTS,
  LONDON_SEGMENTS,
  TOKYO_SEGMENTS,
  UTC_SEGMENTS,
  ZONE_NEW_YORK,
  ZONE_LONDON,
  ZONE_TOKYO,
  ZONE_UTC,
  FROZEN_ZONES,
  getFrozenZone,
} from '../../src/core/zones';
import {
  validateInput,
  validateJsonText,
  validateZoneSegments,
  countRequestDates,
  MAX_JSON_BYTES,
  MAX_REQUEST_DATES,
  MAX_SEGMENTS,
  MIN_SEGMENTS,
  MIN_OFFSET_MINUTES,
  MAX_OFFSET_MINUTES,
} from '../../src/core/validate';

/**
 * 构造一个基准合法的 TimeFoldInput 对象（深拷贝）
 */
function createValidInput(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const base = {
    schema: 'timefold.spec/1',
    name: 'TF-B New York Fall Fold',
    synthetic: true,
    zone: {
      label: 'America/New_York',
      snapshot: 'frozen-2026',
      segments: [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2026-03-08T07:00:00Z',
          offsetMinutes: -300,
        },
        {
          startUtc: '2026-03-08T07:00:00Z',
          endUtc: '2026-11-01T06:00:00Z',
          offsetMinutes: -240,
        },
        {
          startUtc: '2026-11-01T06:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: -300,
        },
      ],
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

  return {
    ...base,
    ...overrides,
  };
}

describe('TASK-P009-T004: 冻结时区分段与输入校验 (MATH01)', () => {
  describe('1. 冻结 2026 时区分段常量与结构验证 (PROJECT_BOOK §5.4)', () => {
    it('freezes unified start and end UTC boundary constants', () => {
      expect(ZONE_START_UTC).toBe('2025-12-30T00:00:00Z');
      expect(ZONE_END_UTC).toBe('2027-01-03T00:00:00Z');
    });

    it('America/New_York has exact 3 segments: -300, -240, -300', () => {
      expect(NEW_YORK_SEGMENTS).toHaveLength(3);
      expect(NEW_YORK_SEGMENTS[0]).toEqual({
        startUtc: '2025-12-30T00:00:00Z',
        endUtc: '2026-03-08T07:00:00Z',
        offsetMinutes: -300,
      });
      expect(NEW_YORK_SEGMENTS[1]).toEqual({
        startUtc: '2026-03-08T07:00:00Z',
        endUtc: '2026-11-01T06:00:00Z',
        offsetMinutes: -240,
      });
      expect(NEW_YORK_SEGMENTS[2]).toEqual({
        startUtc: '2026-11-01T06:00:00Z',
        endUtc: '2027-01-03T00:00:00Z',
        offsetMinutes: -300,
      });
    });

    it('Europe/London has exact 3 segments: 0, +60, 0', () => {
      expect(LONDON_SEGMENTS).toHaveLength(3);
      expect(LONDON_SEGMENTS[0]).toEqual({
        startUtc: '2025-12-30T00:00:00Z',
        endUtc: '2026-03-29T01:00:00Z',
        offsetMinutes: 0,
      });
      expect(LONDON_SEGMENTS[1]).toEqual({
        startUtc: '2026-03-29T01:00:00Z',
        endUtc: '2026-10-25T01:00:00Z',
        offsetMinutes: 60,
      });
      expect(LONDON_SEGMENTS[2]).toEqual({
        startUtc: '2026-10-25T01:00:00Z',
        endUtc: '2027-01-03T00:00:00Z',
        offsetMinutes: 0,
      });
    });

    it('Asia/Tokyo has exact 1 continuous segment: +540', () => {
      expect(TOKYO_SEGMENTS).toHaveLength(1);
      expect(TOKYO_SEGMENTS[0]).toEqual({
        startUtc: '2025-12-30T00:00:00Z',
        endUtc: '2027-01-03T00:00:00Z',
        offsetMinutes: 540,
      });
    });

    it('UTC has exact 1 continuous segment: 0', () => {
      expect(UTC_SEGMENTS).toHaveLength(1);
      expect(UTC_SEGMENTS[0]).toEqual({
        startUtc: '2025-12-30T00:00:00Z',
        endUtc: '2027-01-03T00:00:00Z',
        offsetMinutes: 0,
      });
    });

    it('provides immutable deep cloned copies via getFrozenZone', () => {
      const ny = getFrozenZone(ZONE_LABEL_NEW_YORK);
      expect(ny).toBeDefined();
      expect(ny!.label).toBe('America/New_York');
      expect(ny!.snapshot).toBe('frozen-2026');
      expect(ny!.segments).toHaveLength(3);

      // 变异副本不污染原常量
      ny!.segments[0]!.offsetMinutes = 999;
      const nyAgain = getFrozenZone(ZONE_LABEL_NEW_YORK);
      expect(nyAgain!.segments[0]!.offsetMinutes).toBe(-300);

      expect(getFrozenZone('NonExistentZone')).toBeUndefined();
    });

    it('all four frozen snapshot presets pass validateZoneSegments and validateInput', () => {
      for (const zone of FROZEN_ZONES) {
        expect(() => validateZoneSegments(zone.segments)).not.toThrow();

        const input = createValidInput({
          zone: {
            label: zone.label,
            snapshot: zone.snapshot,
            segments: zone.segments.map((s) => ({ ...s })),
          },
        });
        const res = validateInput(input);
        expect(res.zone.label).toBe(zone.label);
      }
    });
  });

  describe('2. MATH01: 分段全覆盖、半开连续、整数 offset 与非法结构阻断', () => {
    it('MATH01-PASS: accepts completely valid segments for single and multi segments', () => {
      expect(() => validateZoneSegments(ZONE_TOKYO.segments)).not.toThrow();
      expect(() => validateZoneSegments(ZONE_NEW_YORK.segments)).not.toThrow();
      expect(() => validateZoneSegments(ZONE_LONDON.segments)).not.toThrow();
      expect(() => validateZoneSegments(ZONE_UTC.segments)).not.toThrow();
    });

    it('MATH01-GAP: strictly rejects segment gap (hole) with E_SEGMENT_GAP and exact path', () => {
      const gappedSegments = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2026-03-08T07:00:00Z',
          offsetMinutes: -300,
        },
        // 空洞：前一段 07:00 结束，下一段 08:00 才开始，漏了 1 小时
        {
          startUtc: '2026-03-08T08:00:00Z',
          endUtc: '2026-11-01T06:00:00Z',
          offsetMinutes: -240,
        },
        {
          startUtc: '2026-11-01T06:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: -300,
        },
      ];

      try {
        validateZoneSegments(gappedSegments, 'zone.segments');
        expect.unreachable('Should have thrown on gap');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        const tfErr = err as TimeFoldError;
        expect(tfErr.code).toBe('E_SEGMENT_GAP');
        expect(tfErr.path).toBe('zone.segments[1].startUtc');
      }
    });

    it('MATH01-OVERLAP: strictly rejects segment overlap (intersection) with E_SEGMENT_OVERLAP', () => {
      const overlappingSegments = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2026-03-08T07:00:00Z',
          offsetMinutes: -300,
        },
        // 重叠：前一段 07:00 结束，下一段 06:00 提前开始，重叠 1 小时
        {
          startUtc: '2026-03-08T06:00:00Z',
          endUtc: '2026-11-01T06:00:00Z',
          offsetMinutes: -240,
        },
        {
          startUtc: '2026-11-01T06:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: -300,
        },
      ];

      try {
        validateZoneSegments(overlappingSegments, 'zone.segments');
        expect.unreachable('Should have thrown on overlap');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        const tfErr = err as TimeFoldError;
        expect(tfErr.code).toBe('E_SEGMENT_OVERLAP');
        expect(tfErr.path).toBe('zone.segments[1].startUtc');
      }
    });

    it('MATH01-REDUNDANT: strictly rejects adjacent identical offset with E_REDUNDANT_SEGMENT', () => {
      const redundantSegments = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2026-06-01T00:00:00Z',
          offsetMinutes: -300,
        },
        // 相邻相同偏移：-300 连续两段，未合并
        {
          startUtc: '2026-06-01T00:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: -300,
        },
      ];

      try {
        validateZoneSegments(redundantSegments, 'zone.segments');
        expect.unreachable('Should have thrown on redundant segment');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        const tfErr = err as TimeFoldError;
        expect(tfErr.code).toBe('E_REDUNDANT_SEGMENT');
        expect(tfErr.path).toBe('zone.segments[1].offsetMinutes');
      }
    });

    it('MATH01-SEGMENT-COUNT: rejects empty array and > 16 segments with E_SEGMENT_COUNT', () => {
      // 0 segments
      try {
        validateZoneSegments([], 'zone.segments');
        expect.unreachable('Should have thrown on 0 segments');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_SEGMENT_COUNT');
        expect((err as TimeFoldError).path).toBe('zone.segments');
      }

      // 17 segments (exceeding MAX_SEGMENTS = 16)
      const seventeenSegments = [];
      const baseMin = 29446560; // 2025-12-30T00:00:00Z in minutes
      // 构造 17 个相邻交替偏移的合法连续段
      for (let i = 0; i < 17; i++) {
        const startIso = i === 0 ? '2025-12-30T00:00:00Z' : `2026-0${Math.floor(i / 2) + 1}-0${(i % 2) * 10 + 10}T00:00:00Z`;
      }
      // 直接通过均匀切分 2025-12-30 到 2027-01-03
      const totalMinutes = 531360; // 369 days * 1440
      const segSize = Math.floor(totalMinutes / 17);
      const generated17 = [];
      for (let i = 0; i < 17; i++) {
        const sMin = i === 0 ? 0 : i * segSize;
        const eMin = i === 16 ? totalMinutes : (i + 1) * segSize;
        const d1 = new Date(Date.UTC(2025, 11, 30, 0, 0, 0) + sMin * 60000);
        const d2 = new Date(Date.UTC(2025, 11, 30, 0, 0, 0) + eMin * 60000);
        const pad = (n: number) => n.toString().padStart(2, '0');
        const sIso = `${d1.getUTCFullYear()}-${pad(d1.getUTCMonth() + 1)}-${pad(d1.getUTCDate())}T${pad(d1.getUTCHours())}:${pad(d1.getUTCMinutes())}:00Z`;
        const eIso = `${d2.getUTCFullYear()}-${pad(d2.getUTCMonth() + 1)}-${pad(d2.getUTCDate())}T${pad(d2.getUTCHours())}:${pad(d2.getUTCMinutes())}:00Z`;
        generated17.push({
          startUtc: sIso,
          endUtc: eIso,
          offsetMinutes: i % 2 === 0 ? 0 : 60,
        });
      }
      expect(generated17).toHaveLength(17);

      try {
        validateZoneSegments(generated17, 'zone.segments');
        expect.unreachable('Should have thrown on 17 segments');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_SEGMENT_COUNT');
      }

      // Exactly 16 segments should pass segment count check
      const generated16 = generated17.slice(0, 16);
      generated16[15]!.endUtc = '2027-01-03T00:00:00Z';
      expect(() => validateZoneSegments(generated16)).not.toThrow();
    });

    it('MATH01-COVERAGE: rejects segments not covering unified 2025-12-30T00:00:00Z to 2027-01-03T00:00:00Z', () => {
      // 起点不对
      const badStart = [
        {
          startUtc: '2026-01-01T00:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: 0,
        },
      ];
      try {
        validateZoneSegments(badStart, 'zone.segments');
        expect.unreachable('Should throw on bad start');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_SEGMENT_COVERAGE');
        expect((err as TimeFoldError).path).toBe('zone.segments[0].startUtc');
      }

      // 终点不对
      const badEnd = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2026-12-31T00:00:00Z',
          offsetMinutes: 0,
        },
      ];
      try {
        validateZoneSegments(badEnd, 'zone.segments');
        expect.unreachable('Should throw on bad end');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_SEGMENT_COVERAGE');
        expect((err as TimeFoldError).path).toBe('zone.segments[0].endUtc');
      }
    });

    it('MATH01-OFFSET-RANGE: validates -720 to +840 boundary and rejects out-of-range/non-integers', () => {
      // 边界有效值：-720 与 +840
      const boundaryValid = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2026-06-01T00:00:00Z',
          offsetMinutes: MIN_OFFSET_MINUTES, // -720
        },
        {
          startUtc: '2026-06-01T00:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: MAX_OFFSET_MINUTES, // +840
        },
      ];
      expect(() => validateZoneSegments(boundaryValid)).not.toThrow();

      // -721 超下界
      const underflow = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: -721,
        },
      ];
      try {
        validateZoneSegments(underflow, 'zone.segments');
        expect.unreachable('Should throw on -721 offset');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_OFFSET_OUT_OF_RANGE');
        expect((err as TimeFoldError).path).toBe('zone.segments[0].offsetMinutes');
      }

      // +841 超上界
      const overflow = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: 841,
        },
      ];
      try {
        validateZoneSegments(overflow, 'zone.segments');
        expect.unreachable('Should throw on 841 offset');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_OFFSET_OUT_OF_RANGE');
      }

      // 浮点数偏移
      const floatOffset = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2027-01-03T00:00:00Z',
          offsetMinutes: 300.5,
        },
      ];
      try {
        validateZoneSegments(floatOffset, 'zone.segments');
        expect.unreachable('Should throw on float offset');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_OFFSET_OUT_OF_RANGE');
      }
    });

    it('rejects inverted segment bounds (endUtc <= startUtc)', () => {
      const inverted = [
        {
          startUtc: '2025-12-30T00:00:00Z',
          endUtc: '2025-12-30T00:00:00Z', // start == end
          offsetMinutes: 0,
        },
      ];
      try {
        validateZoneSegments(inverted, 'zone.segments');
        expect.unreachable('Should throw on inverted bounds');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_INVALID_SEGMENT_BOUNDS');
        expect((err as TimeFoldError).path).toBe('zone.segments[0].endUtc');
      }
    });
  });

  describe('3. 未知字段与禁止字段拒绝并给出路径', () => {
    it('strictly rejects top-level unknown field and identifies its path', () => {
      const input = createValidInput({
        unrecognizedTopField: 123,
      });

      try {
        validateInput(input);
        expect.unreachable('Should reject unknown top field');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        const tfErr = err as TimeFoldError;
        expect(tfErr.code).toBe('E_UNKNOWN_PROPERTY');
        expect(tfErr.path).toBe('unrecognizedTopField');
      }
    });

    it('strictly rejects forbidden top-level fields (expectedOutput, isRealBusinessData)', () => {
      const inputWithExpected = createValidInput({
        expectedOutput: { fake: true },
      });
      try {
        validateInput(inputWithExpected);
        expect.unreachable('Should reject expectedOutput');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_FORBIDDEN_PROPERTY');
        expect((err as TimeFoldError).path).toBe('expectedOutput');
      }

      const inputWithBusiness = createValidInput({
        isRealBusinessData: true,
      });
      try {
        validateInput(inputWithBusiness);
        expect.unreachable('Should reject isRealBusinessData');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_FORBIDDEN_PROPERTY');
        expect((err as TimeFoldError).path).toBe('isRealBusinessData');
      }
    });

    it('strictly rejects nested unknown fields in zone, schedule, policy, and segments', () => {
      // In zone
      const badZone = createValidInput({
        zone: {
          label: 'America/New_York',
          snapshot: 'frozen-2026',
          segments: [...NEW_YORK_SEGMENTS],
          extraZoneField: 'bad',
        },
      });
      try {
        validateInput(badZone);
        expect.unreachable('Should reject zone.extraZoneField');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_UNKNOWN_PROPERTY');
        expect((err as TimeFoldError).path).toBe('zone.extraZoneField');
      }

      // In schedule
      const badSchedule = createValidInput({
        schedule: {
          frequency: 'once',
          startDate: '2026-11-01',
          endDate: '2026-11-01',
          localTime: '01:30',
          byWeekday: [],
          extraScheduleField: 99,
        },
      });
      try {
        validateInput(badSchedule);
        expect.unreachable('Should reject schedule.extraScheduleField');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_UNKNOWN_PROPERTY');
        expect((err as TimeFoldError).path).toBe('schedule.extraScheduleField');
      }

      // In policy
      const badPolicy = createValidInput({
        policy: {
          gap: 'skip',
          fold: 'both',
          extraPolicyField: false,
        },
      });
      try {
        validateInput(badPolicy);
        expect.unreachable('Should reject policy.extraPolicyField');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_UNKNOWN_PROPERTY');
        expect((err as TimeFoldError).path).toBe('policy.extraPolicyField');
      }

      // In segment
      const badSeg = createValidInput({
        zone: {
          label: 'UTC',
          snapshot: 'frozen-2026',
          segments: [
            {
              startUtc: '2025-12-30T00:00:00Z',
              endUtc: '2027-01-03T00:00:00Z',
              offsetMinutes: 0,
              extraSegmentField: 1,
            },
          ],
        },
      });
      try {
        validateInput(badSeg);
        expect.unreachable('Should reject segment.extraSegmentField');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_UNKNOWN_PROPERTY');
        expect((err as TimeFoldError).path).toBe('zone.segments[0].extraSegmentField');
      }
    });

    it('guards against prototype pollution keys', () => {
      const polluted = JSON.parse('{"schema":"timefold.spec/1","__proto__":{"polluted":true}}');
      try {
        validateInput(polluted);
        expect.unreachable('Should reject prototype pollution');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_PROTOTYPE_POLLUTION');
      }
    });
  });

  describe('4. Schema, Name, Synthetic 与 Policy 约束断言', () => {
    it('enforces schema === "timefold.spec/1"', () => {
      const input = createValidInput({ schema: 'timefold.spec/2' });
      try {
        validateInput(input);
        expect.unreachable();
      } catch (err) {
        expect((err as TimeFoldError).code).toBe('E_INVALID_SCHEMA');
        expect((err as TimeFoldError).path).toBe('schema');
      }
    });

    it('enforces synthetic === true (boolean literal)', () => {
      const inputFalse = createValidInput({ synthetic: false });
      expect(() => validateInput(inputFalse)).toThrow(
        expect.objectContaining({ code: 'E_INVALID_SYNTHETIC', path: 'synthetic' })
      );

      const inputMissing = createValidInput({ synthetic: undefined });
      expect(() => validateInput(inputMissing)).toThrow();
    });

    it('enforces name length <= 80 characters', () => {
      const valid80 = 'A'.repeat(80);
      expect(() => validateInput(createValidInput({ name: valid80 }))).not.toThrow();

      const invalid81 = 'A'.repeat(81);
      try {
        validateInput(createValidInput({ name: invalid81 }));
        expect.unreachable();
      } catch (err) {
        expect((err as TimeFoldError).code).toBe('E_NAME_TOO_LONG');
        expect((err as TimeFoldError).path).toBe('name');
      }
    });

    it('validates gap and fold policy values', () => {
      const badGap = createValidInput({
        policy: { gap: 'invalidGapPolicy', fold: 'both' },
      });
      expect(() => validateInput(badGap)).toThrow(
        expect.objectContaining({ code: 'E_INVALID_GAP_POLICY', path: 'policy.gap' })
      );

      const badFold = createValidInput({
        policy: { gap: 'skip', fold: 'invalidFoldPolicy' },
      });
      expect(() => validateInput(badFold)).toThrow(
        expect.objectContaining({ code: 'E_INVALID_FOLD_POLICY', path: 'policy.fold' })
      );
    });
  });

  describe('5. 排程与 90 请求上限校验（必须包含跨月用例）', () => {
    it('once schedule: startDate must equal endDate', () => {
      // 跨月用例：一旦 startDate != endDate 则立即拒绝
      const unequalDates = createValidInput({
        schedule: {
          frequency: 'once',
          startDate: '2026-03-31',
          endDate: '2026-04-01',
          localTime: '01:30',
          byWeekday: [],
        },
      });

      try {
        validateInput(unequalDates);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_ONCE_DATES_NOT_EQUAL');
        expect((err as TimeFoldError).path).toBe('schedule.endDate');
      }

      // once 必须 byWeekday = []
      const onceWithWeekday = createValidInput({
        schedule: {
          frequency: 'once',
          startDate: '2026-03-15',
          endDate: '2026-03-15',
          localTime: '01:30',
          byWeekday: [1],
        },
      });
      expect(() => validateInput(onceWithWeekday)).toThrow(
        expect.objectContaining({ code: 'E_INVALID_BY_WEEKDAY' })
      );
    });

    it('daily schedule: validates cross-month range calculations correctly', () => {
      // 前车之鉴重点：T003 diffDays 曾因月份传参出错，在此断言跨月计算准确无误
      // 2026-02-15 至 2026-03-15 (平年2月28天: 13天+15天+1=29天)
      const febToMarInput = createValidInput({
        schedule: {
          frequency: 'daily',
          startDate: '2026-02-15',
          endDate: '2026-03-15',
          localTime: '09:00',
          byWeekday: [],
        },
      });
      expect(() => validateInput(febToMarInput)).not.toThrow();
      expect(countRequestDates(febToMarInput.schedule as any)).toBe(29);

      // 跨月 2026-03-15 至 2026-04-15 (3月31天: 16天+15天+1=32天)
      const marToAprInput = createValidInput({
        schedule: {
          frequency: 'daily',
          startDate: '2026-03-15',
          endDate: '2026-04-15',
          localTime: '09:00',
          byWeekday: [],
        },
      });
      expect(() => validateInput(marToAprInput)).not.toThrow();
      expect(countRequestDates(marToAprInput.schedule as any)).toBe(32);

      // 跨年 2025-12-30 至 2026-01-05 (2天+5天=7天)
      const decToJanInput = createValidInput({
        schedule: {
          frequency: 'daily',
          startDate: '2025-12-30',
          endDate: '2026-01-05',
          localTime: '09:00',
          byWeekday: [],
        },
      });
      expect(() => validateInput(decToJanInput)).not.toThrow();
      expect(countRequestDates(decToJanInput.schedule as any)).toBe(7);
    });

    it('strictly enforces 90 request limit: exactly 90 PASSES, 91 REJECTS (spanning March, April, May)', () => {
      // 跨月多月区间：2026-03-01 至 2026-05-29
      // March: 31 days
      // April: 30 days
      // May: 29 days
      // Total = 31 + 30 + 29 = 90 days (正好 90 个请求)
      const exactly90Input = createValidInput({
        schedule: {
          frequency: 'daily',
          startDate: '2026-03-01',
          endDate: '2026-05-29',
          localTime: '09:00',
          byWeekday: [],
        },
      });
      expect(countRequestDates(exactly90Input.schedule as any)).toBe(90);
      expect(() => validateInput(exactly90Input)).not.toThrow();

      // 超界 1 天：2026-03-01 至 2026-05-30
      // Total = 31 + 30 + 30 = 91 days
      const exactly91Input = createValidInput({
        schedule: {
          frequency: 'daily',
          startDate: '2026-03-01',
          endDate: '2026-05-30',
          localTime: '09:00',
          byWeekday: [],
        },
      });
      expect(countRequestDates(exactly91Input.schedule as any)).toBe(91);

      try {
        validateInput(exactly91Input);
        expect.unreachable('Should throw on 91 requests');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        const tfErr = err as TimeFoldError;
        expect(tfErr.code).toBe('E_REQUEST_COUNT_EXCEEDED');
        expect(tfErr.path).toBe('schedule');
        expect(tfErr.message).toContain('91');
      }
    });

    it('weekly schedule: validates sorting, distinctness, and cross-month filtering', () => {
      // 周一星期过滤：2026-03-02（周一）至 2026-03-23（周一），包含 4 个周一 (TF-F 模式)
      const weeklyInput = createValidInput({
        schedule: {
          frequency: 'weekly',
          startDate: '2026-03-02',
          endDate: '2026-03-23',
          localTime: '09:00',
          byWeekday: [1], // Monday
        },
      });
      expect(() => validateInput(weeklyInput)).not.toThrow();
      expect(countRequestDates(weeklyInput.schedule as any)).toBe(4);

      // byWeekday 乱序拒绝: [5, 1] 必须严格升序 [1, 5]
      const unsortedWeekly = createValidInput({
        schedule: {
          frequency: 'weekly',
          startDate: '2026-03-01',
          endDate: '2026-03-31',
          localTime: '09:00',
          byWeekday: [5, 1],
        },
      });
      expect(() => validateInput(unsortedWeekly)).toThrow(
        expect.objectContaining({ code: 'E_INVALID_BY_WEEKDAY' })
      );

      // byWeekday 重复项拒绝: [1, 1]
      const duplicateWeekly = createValidInput({
        schedule: {
          frequency: 'weekly',
          startDate: '2026-03-01',
          endDate: '2026-03-31',
          localTime: '09:00',
          byWeekday: [1, 1],
        },
      });
      expect(() => validateInput(duplicateWeekly)).toThrow(
        expect.objectContaining({ code: 'E_INVALID_BY_WEEKDAY' })
      );

      // byWeekday 超出 1..7 范围
      const outOfRangeWeekly = createValidInput({
        schedule: {
          frequency: 'weekly',
          startDate: '2026-03-01',
          endDate: '2026-03-31',
          localTime: '09:00',
          byWeekday: [0, 8],
        },
      });
      expect(() => validateInput(outOfRangeWeekly)).toThrow(
        expect.objectContaining({ code: 'E_INVALID_BY_WEEKDAY' })
      );

      // byWeekday 为空
      const emptyWeekly = createValidInput({
        schedule: {
          frequency: 'weekly',
          startDate: '2026-03-01',
          endDate: '2026-03-31',
          localTime: '09:00',
          byWeekday: [],
        },
      });
      expect(() => validateInput(emptyWeekly)).toThrow(
        expect.objectContaining({ code: 'E_INVALID_BY_WEEKDAY' })
      );
    });

    it('weekly schedule: handles 90 boundary across multiple months', () => {
      // 跨越 10 个月：2026-01-01 至 2026-11-15
      // 过滤周一与周五 [1, 5]
      // 2026-01-02 是周五(#1), 01-05 是周一(#2)...
      // 2026-11-09 是周一（正好第 90 次）
      const weekly90 = createValidInput({
        schedule: {
          frequency: 'weekly',
          startDate: '2026-01-02',
          endDate: '2026-11-09',
          localTime: '10:00',
          byWeekday: [1, 5],
        },
      });
      const c90 = countRequestDates(weekly90.schedule as any);
      expect(c90).toBe(90);
      expect(() => validateInput(weekly90)).not.toThrow();

      // 延伸到周五 2026-11-13，产生第 91 次请求
      const weekly91 = createValidInput({
        schedule: {
          frequency: 'weekly',
          startDate: '2026-01-02',
          endDate: '2026-11-13',
          localTime: '10:00',
          byWeekday: [1, 5],
        },
      });
      const c91 = countRequestDates(weekly91.schedule as any);
      expect(c91).toBe(91);
      expect(() => validateInput(weekly91)).toThrow(
        expect.objectContaining({ code: 'E_REQUEST_COUNT_EXCEEDED' })
      );
    });
  });

  describe('6. 256 KiB JSON 文本上限边界断言', () => {
    it('accepts valid JSON text well within 256 KiB limit', () => {
      const inputObj = createValidInput();
      const rawJson = JSON.stringify(inputObj);
      expect(new TextEncoder().encode(rawJson).length).toBeLessThan(MAX_JSON_BYTES);

      const parsed = validateJsonText(rawJson);
      expect(parsed.schema).toBe('timefold.spec/1');
    });

    it('accepts JSON text exactly at 256 KiB (262,144 bytes)', () => {
      const baseObj = createValidInput();
      // 在合法 80 字符 name 内无法塞满 256KB，但可以在合法 JSON 内填充空格（完全合法 JSON 文本）
      const baseJson = JSON.stringify(baseObj);
      const baseBytes = new TextEncoder().encode(baseJson).length;
      const neededPadding = MAX_JSON_BYTES - baseBytes;
      expect(neededPadding).toBeGreaterThan(0);

      // JSON 允许顶层前导/尾随空格
      const exact256KiBJson = ' '.repeat(neededPadding) + baseJson;
      const totalBytes = new TextEncoder().encode(exact256KiBJson).length;
      expect(totalBytes).toBe(MAX_JSON_BYTES); // 恰好 262,144 字节

      const parsed = validateJsonText(exact256KiBJson);
      expect(parsed.schema).toBe('timefold.spec/1');
    });

    it('strictly rejects JSON text of 256 KiB + 1 byte (262,145 bytes) with E_JSON_SIZE_EXCEEDED', () => {
      const baseObj = createValidInput();
      const baseJson = JSON.stringify(baseObj);
      const baseBytes = new TextEncoder().encode(baseJson).length;
      const neededPadding = MAX_JSON_BYTES - baseBytes + 1; // 恰好多 1 字节

      const overflowJson = ' '.repeat(neededPadding) + baseJson;
      const totalBytes = new TextEncoder().encode(overflowJson).length;
      expect(totalBytes).toBe(MAX_JSON_BYTES + 1); // 262,145 字节

      try {
        validateJsonText(overflowJson);
        expect.unreachable('Should have rejected oversized JSON');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        const tfErr = err as TimeFoldError;
        expect(tfErr.code).toBe('E_JSON_SIZE_EXCEEDED');
        expect(tfErr.path).toBe('');
        expect(tfErr.message).toContain('262145');
      }
    });

    it('rejects malformed JSON syntax with E_JSON_SYNTAX', () => {
      const brokenJson = '{ "schema": "timefold.spec/1", ';
      try {
        validateJsonText(brokenJson);
        expect.unreachable('Should have rejected syntax error');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_JSON_SYNTAX');
      }
    });
  });

  describe('7. 错误契约结构保障（必须包含 code, path, message）', () => {
    it('guarantees TimeFoldError contains code, path, message and serializes properly', () => {
      const err = new TimeFoldError({
        code: 'E_SEGMENT_GAP',
        path: 'zone.segments[1].startUtc',
        message: 'Test segment gap message',
      });

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(TimeFoldError);
      expect(err.code).toBe('E_SEGMENT_GAP');
      expect(err.path).toBe('zone.segments[1].startUtc');
      expect(err.message).toBe('Test segment gap message');

      const json = err.toJSON();
      expect(json).toEqual({
        code: 'E_SEGMENT_GAP',
        path: 'zone.segments[1].startUtc',
        message: 'Test segment gap message',
      });
    });
  });
});
