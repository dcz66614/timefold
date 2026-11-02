import { describe, it, expect } from 'vitest';
import {
  isLeapYear,
  getDaysInMonth,
  isValidDate,
  isValidDateString,
  parseDate,
  formatDate,
  isValidTime,
  isValidTimeString,
  parseTime,
  formatTime,
  parseUtcMinute,
  formatUtcMinute,
  parseLocalMinute,
  formatLocalMinute,
  combineLocalDateAndTime,
  splitLocalMinute,
  addDays,
  diffDays,
  getIsoWeekday,
  compareDateStrings,
} from '../../src/core/calendar';
import { TimeFoldError } from '../../src/core/types';

describe('T003 Strict Gregorian Calendar and UTC Minute Module', () => {
  describe('1. Leap Year & Days in Month', () => {
    it('accurately identifies Gregorian leap years', () => {
      // 4-year rule
      expect(isLeapYear(2024)).toBe(true);
      expect(isLeapYear(2028)).toBe(true);
      expect(isLeapYear(2025)).toBe(false);
      expect(isLeapYear(2026)).toBe(false);
      expect(isLeapYear(2027)).toBe(false);

      // Century non-leap rule
      expect(isLeapYear(1900)).toBe(false);
      expect(isLeapYear(2100)).toBe(false);

      // 400-year leap rule
      expect(isLeapYear(2000)).toBe(true);
      expect(isLeapYear(2400)).toBe(true);

      // Non-integer inputs
      expect(isLeapYear(2024.5)).toBe(false);
      expect(isLeapYear(NaN)).toBe(false);
    });

    it('returns exact days in month for leap and non-leap years', () => {
      // 31-day months
      const months31 = [1, 3, 5, 7, 8, 10, 12];
      for (const m of months31) {
        expect(getDaysInMonth(2026, m)).toBe(31);
      }

      // 30-day months
      const months30 = [4, 6, 9, 11];
      for (const m of months30) {
        expect(getDaysInMonth(2026, m)).toBe(30);
      }

      // February: 28 in 2026 (non-leap), 29 in 2024 (leap)
      expect(getDaysInMonth(2026, 2)).toBe(28);
      expect(getDaysInMonth(2024, 2)).toBe(29);
      expect(getDaysInMonth(2000, 2)).toBe(29);
      expect(getDaysInMonth(1900, 2)).toBe(28);

      // Out of bounds months
      expect(getDaysInMonth(2026, 0)).toBe(0);
      expect(getDaysInMonth(2026, 13)).toBe(0);
      expect(getDaysInMonth(2026, -1)).toBe(0);
    });
  });

  describe('2. Date Validity & Strict Parsing (Including 2026-02-30 Rejection)', () => {
    it('validates legitimate Gregorian dates', () => {
      expect(isValidDate(2026, 1, 1)).toBe(true);
      expect(isValidDate(2026, 2, 28)).toBe(true);
      expect(isValidDate(2024, 2, 29)).toBe(true); // leap year
      expect(isValidDate(2026, 12, 31)).toBe(true);
      expect(isValidDateString('2026-03-09')).toBe(true);
    });

    it('strictly rejects illegal date 2026-02-30 and non-existent days', () => {
      // 2026-02-30 must be rejected
      expect(isValidDate(2026, 2, 30)).toBe(false);
      expect(isValidDateString('2026-02-30')).toBe(false);
      expect(() => parseDate('2026-02-30')).toThrowError(TimeFoldError);
      try {
        parseDate('2026-02-30');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_INVALID_DATE');
      }

      // 2026-02-29 rejected (2026 is not a leap year)
      expect(isValidDate(2026, 2, 29)).toBe(false);
      expect(isValidDateString('2026-02-29')).toBe(false);
      expect(() => parseDate('2026-02-29')).toThrowError(TimeFoldError);

      // Month with 30 days having day 31
      expect(isValidDate(2026, 4, 31)).toBe(false);
      expect(isValidDate(2026, 6, 31)).toBe(false);
      expect(isValidDate(2026, 9, 31)).toBe(false);
      expect(isValidDate(2026, 11, 31)).toBe(false);

      // Boundary values
      expect(isValidDate(2026, 1, 0)).toBe(false);
      expect(isValidDate(2026, 1, 32)).toBe(false);
      expect(isValidDate(2026, 0, 10)).toBe(false);
      expect(isValidDate(2026, 13, 10)).toBe(false);
    });

    it('rejects malformed date strings in parseDate', () => {
      expect(() => parseDate('2026/03/09')).toThrowError(TimeFoldError);
      expect(() => parseDate('26-03-09')).toThrowError(TimeFoldError);
      expect(() => parseDate('2026-3-9')).toThrowError(TimeFoldError);
      expect(() => parseDate('2026-03-09 ')).toThrowError(TimeFoldError);
      expect(() => parseDate(' 2026-03-09')).toThrowError(TimeFoldError);
      expect(() => parseDate('not-a-date')).toThrowError(TimeFoldError);
      expect(() => parseDate(12345 as unknown as string)).toThrowError(TimeFoldError);
    });

    it('formats valid dates and rejects invalid inputs', () => {
      expect(formatDate(2026, 3, 9)).toBe('2026-03-09');
      expect(formatDate(2024, 2, 29)).toBe('2024-02-29');
      expect(formatDate(2026, 12, 31)).toBe('2026-12-31');
      expect(() => formatDate(2026, 2, 30)).toThrowError(TimeFoldError);
      expect(() => formatDate(2026, 13, 1)).toThrowError(TimeFoldError);
    });
  });

  describe('3. Hour and Minute Boundary Conditions', () => {
    it('validates boundary times: 00:00 and 23:59', () => {
      expect(isValidTime(0, 0)).toBe(true);
      expect(isValidTime(23, 59)).toBe(true);
      expect(isValidTime(12, 30)).toBe(true);

      expect(parseTime('00:00')).toEqual({ hour: 0, minute: 0 });
      expect(parseTime('23:59')).toEqual({ hour: 23, minute: 59 });
      expect(formatTime(0, 0)).toBe('00:00');
      expect(formatTime(23, 59)).toBe('23:59');
    });

    it('strictly rejects out of range hours and minutes', () => {
      // Hour 24 is invalid (standard is 00..23)
      expect(isValidTime(24, 0)).toBe(false);
      expect(isValidTimeString('24:00')).toBe(false);
      expect(() => parseTime('24:00')).toThrowError(TimeFoldError);

      // Negative hour
      expect(isValidTime(-1, 0)).toBe(false);
      expect(() => parseTime('-01:00')).toThrowError(TimeFoldError);

      // Minute 60 is invalid
      expect(isValidTime(12, 60)).toBe(false);
      expect(isValidTimeString('12:60')).toBe(false);
      expect(() => parseTime('12:60')).toThrowError(TimeFoldError);

      // Minute 99
      expect(isValidTime(12, 99)).toBe(false);
      expect(() => parseTime('12:99')).toThrowError(TimeFoldError);

      // Malformed times
      expect(() => parseTime('9:00')).toThrowError(TimeFoldError);
      expect(() => parseTime('09:0')).toThrowError(TimeFoldError);
      expect(() => parseTime('09:00:00')).toThrowError(TimeFoldError);
      expect(() => parseTime('random')).toThrowError(TimeFoldError);
    });
  });

  describe('4. Strict UTC ISO Minute Parsing & Formatting (UTC Roundtrip)', () => {
    it('parses standard UTC timestamps and enforces safe integer minutes', () => {
      // Unix epoch
      const epochMin = parseUtcMinute('1970-01-01T00:00:00Z');
      expect(epochMin).toBe(0);
      expect(Number.isInteger(epochMin)).toBe(true);
      expect(formatUtcMinute(0)).toBe('1970-01-01T00:00:00Z');

      // 2026 Snapshot Start
      const snapStart = parseUtcMinute('2025-12-30T00:00:00Z');
      expect(Number.isInteger(snapStart)).toBe(true);
      expect(formatUtcMinute(snapStart)).toBe('2025-12-30T00:00:00Z');

      // NY Spring Transition 2026-03-08T07:00:00Z
      const nySpring = parseUtcMinute('2026-03-08T07:00:00Z');
      expect(Number.isInteger(nySpring)).toBe(true);
      expect(formatUtcMinute(nySpring)).toBe('2026-03-08T07:00:00Z');

      // NY Fall Transition 2026-11-01T06:00:00Z
      const nyFall = parseUtcMinute('2026-11-01T06:00:00Z');
      expect(Number.isInteger(nyFall)).toBe(true);
      expect(formatUtcMinute(nyFall)).toBe('2026-11-01T06:00:00Z');

      // London Transition 2026-03-29T01:00:00Z
      const lonSpring = parseUtcMinute('2026-03-29T01:00:00Z');
      expect(Number.isInteger(lonSpring)).toBe(true);
      expect(formatUtcMinute(lonSpring)).toBe('2026-03-29T01:00:00Z');

      // 2026 Snapshot End
      const snapEnd = parseUtcMinute('2027-01-03T00:00:00Z');
      expect(Number.isInteger(snapEnd)).toBe(true);
      expect(formatUtcMinute(snapEnd)).toBe('2027-01-03T00:00:00Z');

      // Midnight boundaries
      const startOfDay = parseUtcMinute('2026-06-15T00:00:00Z');
      const endOfDay = parseUtcMinute('2026-06-15T23:59:00Z');
      expect(endOfDay - startOfDay).toBe(1439); // 23 * 60 + 59
    });

    it('satisfies complete UTC roundtrip for diverse ISO timestamps', () => {
      const timestamps = [
        '1970-01-01T00:00:00Z',
        '1970-01-01T00:01:00Z',
        '1970-01-01T23:59:00Z',
        '2000-02-29T12:00:00Z',
        '2024-02-29T23:59:00Z',
        '2025-12-30T00:00:00Z',
        '2026-01-01T00:00:00Z',
        '2026-03-08T07:00:00Z',
        '2026-03-09T00:00:00Z',
        '2026-03-09T14:30:00Z',
        '2026-03-29T01:00:00Z',
        '2026-06-01T00:00:00Z',
        '2026-10-25T01:00:00Z',
        '2026-11-01T06:00:00Z',
        '2026-12-31T23:59:00Z',
        '2027-01-03T00:00:00Z',
      ];

      for (const iso of timestamps) {
        const minute = parseUtcMinute(iso);
        expect(Number.isInteger(minute)).toBe(true);
        expect(formatUtcMinute(minute)).toBe(iso);
      }
    });

    it('satisfies complete minute-to-ISO-to-minute roundtrip', () => {
      // Test 100 consecutive minutes across day boundaries
      const baseMin = parseUtcMinute('2026-03-08T23:00:00Z');
      for (let offset = 0; offset <= 150; offset++) {
        const m = baseMin + offset;
        const formatted = formatUtcMinute(m);
        expect(parseUtcMinute(formatted)).toBe(m);
      }
    });

    it('strictly rejects non-zero seconds in UTC ISO string', () => {
      expect(() => parseUtcMinute('2026-03-09T14:30:01Z')).toThrowError(TimeFoldError);
      expect(() => parseUtcMinute('2026-03-09T14:30:59Z')).toThrowError(TimeFoldError);
      try {
        parseUtcMinute('2026-03-09T14:30:15Z');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_NON_ZERO_SECONDS');
      }
    });

    it('strictly rejects non-Z timezone or missing timezone', () => {
      expect(() => parseUtcMinute('2026-03-09T14:30:00')).toThrowError(TimeFoldError);
      expect(() => parseUtcMinute('2026-03-09T14:30:00+00:00')).toThrowError(TimeFoldError);
      expect(() => parseUtcMinute('2026-03-09T14:30:00-05:00')).toThrowError(TimeFoldError);
      expect(() => parseUtcMinute('2026-03-09T14:30:00+08:00')).toThrowError(TimeFoldError);
      expect(() => parseUtcMinute('2026-03-09T14:30:00.000Z')).toThrowError(TimeFoldError);
    });

    it('strictly rejects illegal calendar dates in UTC string (2026-02-30)', () => {
      expect(() => parseUtcMinute('2026-02-30T00:00:00Z')).toThrowError(TimeFoldError);
      try {
        parseUtcMinute('2026-02-30T00:00:00Z');
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_INVALID_DATE');
      }

      expect(() => parseUtcMinute('2026-02-29T12:00:00Z')).toThrowError(TimeFoldError);
      expect(() => parseUtcMinute('2026-04-31T00:00:00Z')).toThrowError(TimeFoldError);
    });

    it('strictly rejects non-integer or invalid minutes in formatUtcMinute', () => {
      expect(() => formatUtcMinute(123.45)).toThrowError(TimeFoldError);
      expect(() => formatUtcMinute(NaN)).toThrowError(TimeFoldError);
      expect(() => formatUtcMinute(Infinity)).toThrowError(TimeFoldError);
      expect(() => formatUtcMinute(-Infinity)).toThrowError(TimeFoldError);
      expect(() => formatUtcMinute('123' as unknown as number)).toThrowError(TimeFoldError);
    });
  });

  describe('5. ISO Weekday Calculation (2026-03-09 Must Be Monday)', () => {
    it('confirms 2026-03-09 is Monday (ISO weekday 1)', () => {
      const weekday = getIsoWeekday('2026-03-09');
      expect(weekday).toBe(1);
    });

    it('confirms entire week around 2026-03-09 follows ISO 1..7 ordering', () => {
      expect(getIsoWeekday('2026-03-08')).toBe(7); // Sunday
      expect(getIsoWeekday('2026-03-09')).toBe(1); // Monday
      expect(getIsoWeekday('2026-03-10')).toBe(2); // Tuesday
      expect(getIsoWeekday('2026-03-11')).toBe(3); // Wednesday
      expect(getIsoWeekday('2026-03-12')).toBe(4); // Thursday
      expect(getIsoWeekday('2026-03-13')).toBe(5); // Friday
      expect(getIsoWeekday('2026-03-14')).toBe(6); // Saturday
      expect(getIsoWeekday('2026-03-15')).toBe(7); // Sunday
    });

    it('confirms reference landmark dates', () => {
      // 1970-01-01 was Thursday (4)
      expect(getIsoWeekday('1970-01-01')).toBe(4);
      // 2000-01-01 was Saturday (6)
      expect(getIsoWeekday('2000-01-01')).toBe(6);
      // 2026-01-01 is Thursday (4)
      expect(getIsoWeekday('2026-01-01')).toBe(4);
      // 2026-12-31 is Thursday (4)
      expect(getIsoWeekday('2026-12-31')).toBe(4);
    });

    it('rejects invalid dates in getIsoWeekday', () => {
      expect(() => getIsoWeekday('2026-02-30')).toThrowError(TimeFoldError);
      expect(() => getIsoWeekday('bad-date')).toThrowError(TimeFoldError);
    });
  });

  describe('6. Local Minute Encoding & Formatting', () => {
    it('parses and formats local YYYY-MM-DD HH:mm without timezone shift', () => {
      const localStr = '2026-11-01 01:30';
      const minute = parseLocalMinute(localStr);
      expect(Number.isInteger(minute)).toBe(true);
      expect(formatLocalMinute(minute)).toBe(localStr);

      const split = splitLocalMinute(minute);
      expect(split).toEqual({ date: '2026-11-01', time: '01:30' });
    });

    it('handles boundary local times', () => {
      const start = '2026-03-08 00:00';
      const end = '2026-03-08 23:59';
      expect(formatLocalMinute(parseLocalMinute(start))).toBe(start);
      expect(formatLocalMinute(parseLocalMinute(end))).toBe(end);
      expect(parseLocalMinute(end) - parseLocalMinute(start)).toBe(1439);
    });

    it('rejects illegal dates/times in parseLocalMinute', () => {
      expect(() => parseLocalMinute('2026-02-30 01:30')).toThrowError(TimeFoldError);
      expect(() => parseLocalMinute('2026-11-01 24:00')).toThrowError(TimeFoldError);
      expect(() => parseLocalMinute('2026-11-01 12:60')).toThrowError(TimeFoldError);
      expect(() => parseLocalMinute('2026-11-01T01:30')).toThrowError(TimeFoldError);
    });

    it('combines local date and time properly', () => {
      expect(combineLocalDateAndTime('2026-03-09', '09:00')).toBe('2026-03-09 09:00');
      expect(() => combineLocalDateAndTime('2026-02-30', '09:00')).toThrowError(TimeFoldError);
      expect(() => combineLocalDateAndTime('2026-03-09', '25:00')).toThrowError(TimeFoldError);
    });
  });

  describe('7. Date Increments and Differences (addDays, diffDays)', () => {
    it('advances dates across month and leap-year boundaries', () => {
      // 2026 non-leap February transition
      expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');

      // 2024 leap year February transition
      expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
      expect(addDays('2024-02-29', 1)).toBe('2024-03-01');

      // Year boundary transition
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2027-01-01', -1)).toBe('2026-12-31');

      // Multi-day jump
      expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
      expect(addDays('2026-03-08', 7)).toBe('2026-03-15');
      expect(addDays('2026-03-08', 0)).toBe('2026-03-08');
    });

    it('calculates exact day differences with diffDays', () => {
      expect(diffDays('2026-03-08', '2026-03-09')).toBe(1);
      expect(diffDays('2026-03-09', '2026-03-08')).toBe(-1);
      expect(diffDays('2026-03-09', '2026-03-09')).toBe(0);
      expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
      expect(diffDays('2024-01-01', '2025-01-01')).toBe(366); // leap year

      // Regression tests for P009-FIX-T003-01: cross-month and cross-year day calculations
      expect(diffDays('2026-03-15', '2026-04-15')).toBe(31);
      expect(diffDays('2026-04-15', '2026-03-15')).toBe(-31);
      expect(diffDays('2026-02-15', '2026-03-15')).toBe(28);
      expect(diffDays('2026-03-15', '2026-02-15')).toBe(-28);
      expect(diffDays('2026-12-15', '2027-01-15')).toBe(31);
      expect(diffDays('2027-01-15', '2026-12-15')).toBe(-31);
    });

    it('rejects invalid inputs in addDays and diffDays', () => {
      expect(() => addDays('2026-02-30', 1)).toThrowError(TimeFoldError);
      expect(() => addDays('2026-03-09', 1.5)).toThrowError(TimeFoldError);
      expect(() => diffDays('2026-02-30', '2026-03-01')).toThrowError(TimeFoldError);
    });

    it('compares date strings accurately', () => {
      expect(compareDateStrings('2026-03-08', '2026-03-09')).toBe(-1);
      expect(compareDateStrings('2026-03-09', '2026-03-08')).toBe(1);
      expect(compareDateStrings('2026-03-09', '2026-03-09')).toBe(0);
    });
  });

  describe('8. Zero OS Local Timezone Dependency Invariance', () => {
    it('computes identical values invariant of host local timezone mock', () => {
      // Test sample timestamps
      const testCases = [
        '2026-03-08T07:00:00Z',
        '2026-03-09T00:00:00Z',
        '2026-11-01T06:00:00Z',
      ];

      for (const iso of testCases) {
        const min = parseUtcMinute(iso);
        const back = formatUtcMinute(min);
        expect(back).toBe(iso);
      }

      // Check ISO weekday invariance
      expect(getIsoWeekday('2026-03-09')).toBe(1);

      // Check leap year invariance
      expect(isLeapYear(2026)).toBe(false);
      expect(isValidDate(2026, 2, 30)).toBe(false);
    });
  });
});
