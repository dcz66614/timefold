import {
  type MappingCandidate,
  type SelectedMapping,
  type TimeFoldInput,
  type TimeFoldPolicy,
  type TimeFoldSchedule,
  type ZoneSegment,
  TimeFoldError,
} from './types';
import {
  addDays,
  combineLocalDateAndTime,
  diffDays,
  getIsoWeekday,
  parseDate,
} from './calendar';
import { mapLocal, projectUtc } from './map';
import {
  NEW_YORK_SEGMENTS,
  LONDON_SEGMENTS,
  TOKYO_SEGMENTS,
  UTC_SEGMENTS,
} from './zones';
import { MAX_REQUEST_DATES } from './validate';

export { MAX_REQUEST_DATES };

/**
 * 预设分段映射表，用于当 resolveMapping 未显式传入 segs 时的安全回投
 */
const PRESET_SEGMENTS_MAP: Record<string, readonly ZoneSegment[]> = {
  'America/New_York': NEW_YORK_SEGMENTS,
  'Europe/London': LONDON_SEGMENTS,
  'Asia/Tokyo': TOKYO_SEGMENTS,
  UTC: UTC_SEGMENTS,
};

/**
 * 当未提供 segs 时，查找与 gap 边界及 requestedLocal 匹配的预设并反投
 */
function resolvePresetBoundaryLocal(
  boundaryUtc: string,
  requestedLocal: string
): string {
  for (const segs of Object.values(PRESET_SEGMENTS_MAP)) {
    try {
      const candidate = mapLocal(requestedLocal, segs);
      if (candidate.status === 'GAP' && candidate.gapBoundaryUtc === boundaryUtc) {
        return projectUtc(boundaryUtc, segs);
      }
    } catch {
      // 忽略不匹配的时区分段
    }
  }

  // 若未精准匹配，尝试直接以有效分段投影
  for (const segs of Object.values(PRESET_SEGMENTS_MAP)) {
    try {
      return projectUtc(boundaryUtc, segs);
    } catch {
      // 忽略
    }
  }

  throw new TimeFoldError({
    code: 'E_MISSING_SEGMENTS',
    path: 'zone.segments',
    message: 'Zone segments required to project gap realizedLocal',
  });
}

/**
 * 策略裁决核心：
 * 对 mapLocal 产生的候选 MappingCandidate，应用 gap 策略与 fold 策略，
 * 确定最终选中的 UTC 实例与实际实现的本地时间。
 *
 * 策略规则 (PROJECT_BOOK.md §5.2–§5.3, §8 MATH07):
 * - NORMAL: 正常单候选不受策略影响。
 * - FOLD:
 *   - earlier: 取较早 UTC (candidatesUtc[0])，选中 1 个。
 *   - later: 取较晚 UTC (candidatesUtc[1])，选中 1 个。
 *   - both: 取两个 UTC，保持升序，不隐式去重，选中 2 个。
 *   - 不改动/不污染 candidatesUtc。
 * - GAP:
 *   - skip: 不创建实例，selectedUtc 为 []，realizedLocal 为 []。
 *   - shiftForward: 映射到缺失区间结束时第一个有效本地分钟 (gapBoundaryUtc)。
 *     纽约 02:30 -> 03:00 (07:00Z)，伦敦 01:30 -> 02:00 (01:00Z)。
 *     不是 Temporal compatible (03:30)。
 *     不改动 candidatesUtc (保持 [])。
 */
export function resolveMapping(
  candidate: MappingCandidate,
  policy: TimeFoldPolicy,
  segs?: readonly ZoneSegment[]
): SelectedMapping {
  if (!candidate || typeof candidate !== 'object') {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'candidate',
      message: 'Candidate must be an object',
    });
  }

  if (typeof candidate.requestedLocal !== 'string') {
    throw new TimeFoldError({
      code: 'E_INVALID_LOCAL_FORMAT',
      path: 'candidate.requestedLocal',
      message: 'Candidate requestedLocal is required',
    });
  }

  if (!policy || typeof policy !== 'object') {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'policy',
      message: 'Policy must be an object',
    });
  }

  if (policy.gap !== 'skip' && policy.gap !== 'shiftForward') {
    throw new TimeFoldError({
      code: 'E_INVALID_POLICY',
      path: 'policy.gap',
      message: `Invalid gap policy: ${policy.gap}`,
    });
  }

  if (
    policy.fold !== 'earlier' &&
    policy.fold !== 'later' &&
    policy.fold !== 'both'
  ) {
    throw new TimeFoldError({
      code: 'E_INVALID_POLICY',
      path: 'policy.fold',
      message: `Invalid fold policy: ${policy.fold}`,
    });
  }

  // 1. NORMAL 单候选不受策略影响
  if (candidate.status === 'NORMAL') {
    return {
      requestedLocal: candidate.requestedLocal,
      status: 'NORMAL',
      candidatesUtc: [...candidate.candidatesUtc],
      selectedUtc: [...candidate.candidatesUtc],
      realizedLocal: [candidate.requestedLocal],
      gapBoundaryUtc: null,
    };
  }

  // 2. FOLD 两候选策略裁决 (earlier / later / both)
  if (candidate.status === 'FOLD') {
    const candidatesUtc = [...candidate.candidatesUtc];
    let selectedUtc: string[];

    if (policy.fold === 'earlier') {
      selectedUtc = candidatesUtc.length > 0 ? [candidatesUtc[0]!] : [];
    } else if (policy.fold === 'later') {
      selectedUtc =
        candidatesUtc.length > 0
          ? [candidatesUtc[candidatesUtc.length - 1]!]
          : [];
    } else {
      // both: 取全部候选，保持严格升序与双实例唯一性，不隐式去重
      selectedUtc = [...candidatesUtc];
    }

    const realizedLocal = selectedUtc.map(() => candidate.requestedLocal);

    return {
      requestedLocal: candidate.requestedLocal,
      status: 'FOLD',
      candidatesUtc,
      selectedUtc,
      realizedLocal,
      gapBoundaryUtc: null,
    };
  }

  // 3. GAP 缺口策略裁决 (skip / shiftForward)
  if (candidate.status === 'GAP') {
    const candidatesUtc = [...candidate.candidatesUtc];

    if (policy.gap === 'skip') {
      return {
        requestedLocal: candidate.requestedLocal,
        status: 'GAP',
        candidatesUtc,
        selectedUtc: [],
        realizedLocal: [],
        gapBoundaryUtc: candidate.gapBoundaryUtc,
      };
    }

    // shiftForward: 映射到跃迁分界点 (缺失区间结束时第一个有效本地分钟)
    if (!candidate.gapBoundaryUtc) {
      return {
        requestedLocal: candidate.requestedLocal,
        status: 'GAP',
        candidatesUtc,
        selectedUtc: [],
        realizedLocal: [],
        gapBoundaryUtc: null,
      };
    }

    const boundaryUtc = candidate.gapBoundaryUtc;
    const selectedUtc = [boundaryUtc];

    let realized: string;
    if (segs && segs.length > 0) {
      realized = projectUtc(boundaryUtc, segs);
    } else {
      realized = resolvePresetBoundaryLocal(
        boundaryUtc,
        candidate.requestedLocal
      );
    }

    return {
      requestedLocal: candidate.requestedLocal,
      status: 'GAP',
      candidatesUtc,
      selectedUtc,
      realizedLocal: [realized],
      gapBoundaryUtc: candidate.gapBoundaryUtc,
    };
  }

  throw new TimeFoldError({
    code: 'E_INVALID_STATUS',
    path: 'candidate.status',
    message: `Invalid candidate status: ${(candidate as MappingCandidate).status}`,
  });
}

/**
 * 展开排程请求日期 (PROJECT_BOOK.md §5.3, §5.5 与 IMPLEMENTATION_PLAN.md §2.3):
 * - once: 只生成 startDate (需满足 startDate === endDate)
 * - daily: 按起止范围每个公历日逐日生成
 * - weekly: 按 ISO 星期集合 (1..7) 筛选，依日期升序递增
 *
 * 90 请求限制：
 * - 恰好 90 个请求日期通过
 * - 超过 90 个请求日期抛出 E_REQUEST_COUNT_EXCEEDED
 * - 0 个请求日期抛出 E_REQUEST_COUNT_EMPTY
 */
export function expandLocalDates(
  inputOrSchedule: TimeFoldInput | TimeFoldSchedule
): string[] {
  if (!inputOrSchedule || typeof inputOrSchedule !== 'object') {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'schedule',
      message: 'Schedule must be an object',
    });
  }

  const schedule: TimeFoldSchedule =
    'schedule' in inputOrSchedule
      ? (inputOrSchedule as TimeFoldInput).schedule
      : (inputOrSchedule as TimeFoldSchedule);

  if (!schedule || typeof schedule !== 'object') {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'schedule',
      message: 'Schedule must be an object',
    });
  }

  const { frequency, startDate, endDate, byWeekday } = schedule;

  if (typeof startDate !== 'string') {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'schedule.startDate',
      message: 'startDate must be a string',
    });
  }

  if (typeof endDate !== 'string') {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'schedule.endDate',
      message: 'endDate must be a string',
    });
  }

  parseDate(startDate, 'schedule.startDate');
  parseDate(endDate, 'schedule.endDate');

  if (frequency === 'once') {
    if (startDate !== endDate) {
      throw new TimeFoldError({
        code: 'E_ONCE_DATES_NOT_EQUAL',
        path: 'schedule.endDate',
        message: `For frequency 'once', startDate (${startDate}) and endDate (${endDate}) must be equal`,
      });
    }
    return [startDate];
  }

  if (frequency === 'daily') {
    const diff = diffDays(startDate, endDate);
    if (diff < 0) {
      throw new TimeFoldError({
        code: 'E_START_DATE_AFTER_END_DATE',
        path: 'schedule.startDate',
        message: `startDate (${startDate}) must not be after endDate (${endDate})`,
      });
    }

    const count = diff + 1;
    if (count > MAX_REQUEST_DATES) {
      throw new TimeFoldError({
        code: 'E_REQUEST_COUNT_EXCEEDED',
        path: 'schedule',
        message: `Schedule produces ${count} request dates, exceeding maximum limit of ${MAX_REQUEST_DATES}`,
      });
    }

    const dates: string[] = [];
    for (let i = 0; i <= diff; i++) {
      dates.push(addDays(startDate, i));
    }
    return dates;
  }

  if (frequency === 'weekly') {
    const diff = diffDays(startDate, endDate);
    if (diff < 0) {
      throw new TimeFoldError({
        code: 'E_START_DATE_AFTER_END_DATE',
        path: 'schedule.startDate',
        message: `startDate (${startDate}) must not be after endDate (${endDate})`,
      });
    }

    if (!Array.isArray(byWeekday) || byWeekday.length === 0) {
      throw new TimeFoldError({
        code: 'E_INVALID_BY_WEEKDAY',
        path: 'schedule.byWeekday',
        message: 'byWeekday must be non-empty for frequency "weekly"',
      });
    }

    for (let idx = 0; idx < byWeekday.length; idx++) {
      const w = byWeekday[idx];
      if (typeof w !== 'number' || !Number.isInteger(w) || w < 1 || w > 7) {
        throw new TimeFoldError({
          code: 'E_INVALID_BY_WEEKDAY',
          path: `schedule.byWeekday[${idx}]`,
          message: `byWeekday elements must be integers between 1 and 7, got ${w}`,
        });
      }
      if (idx > 0 && w <= byWeekday[idx - 1]!) {
        throw new TimeFoldError({
          code: 'E_INVALID_BY_WEEKDAY',
          path: `schedule.byWeekday[${idx}]`,
          message:
            'byWeekday must be strictly sorted distinct integers in 1..7',
        });
      }
    }

    const weekdaySet = new Set(byWeekday);
    const dates: string[] = [];
    for (let i = 0; i <= diff; i++) {
      const d = addDays(startDate, i);
      const wd = getIsoWeekday(d);
      if (weekdaySet.has(wd)) {
        dates.push(d);
      }
    }

    if (dates.length === 0) {
      throw new TimeFoldError({
        code: 'E_REQUEST_COUNT_EMPTY',
        path: 'schedule',
        message: 'Schedule produces 0 request dates',
      });
    }

    if (dates.length > MAX_REQUEST_DATES) {
      throw new TimeFoldError({
        code: 'E_REQUEST_COUNT_EXCEEDED',
        path: 'schedule',
        message: `Schedule produces ${dates.length} request dates, exceeding maximum limit of ${MAX_REQUEST_DATES}`,
      });
    }

    return dates;
  }

  throw new TimeFoldError({
    code: 'E_INVALID_FREQUENCY',
    path: 'schedule.frequency',
    message: `Invalid frequency: ${frequency}`,
  });
}

/**
 * 完整排程展开与策略裁决：
 * 根据输入的 schedule 展开所有请求日期，组合 localTime 并调用 mapLocal，
 * 随后经由 resolveMapping 裁决为 SelectedMapping[]。
 */
export function expandScheduleMappings(
  input: TimeFoldInput
): SelectedMapping[] {
  const dates = expandLocalDates(input);
  const results: SelectedMapping[] = [];

  for (const date of dates) {
    const localLabel = combineLocalDateAndTime(date, input.schedule.localTime);
    const candidate = mapLocal(localLabel, input.zone.segments);
    const selected = resolveMapping(
      candidate,
      input.policy,
      input.zone.segments
    );
    results.push(selected);
  }

  return results;
}
