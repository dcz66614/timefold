import {
  type MappingCandidate,
  type ZoneSegment,
  TimeFoldError,
} from './types';
import {
  formatLocalMinute,
  formatUtcMinute,
  parseLocalMinute,
  parseUtcMinute,
} from './calendar';

/**
 * P009 时隙镜 TimeFold — 墙上时间反像核心与 UTC 本地投影
 *
 * 严格遵循 PROJECT_BOOK.md §5.1–§5.2 与 IMPLEMENTATION_PLAN.md §2.3。
 * 绝不使用系统本地时区或 Intl 作为真值，纯依赖整数分钟与分段表算术。
 */

/**
 * 寻找本地分钟在分段表中的所有 UTC 候选分钟（升序去重）。
 * 若候选数 > 2，按规范抛出 E_AMBIGUITY_GT2。
 */
export function findCandidateUtcMinutes(
  localMin: number,
  segs: readonly ZoneSegment[],
  path: string = 'requestedLocal'
): number[] {
  if (
    typeof localMin !== 'number' ||
    !Number.isInteger(localMin) ||
    !Number.isSafeInteger(localMin)
  ) {
    throw new TimeFoldError({
      code: 'E_INVALID_MINUTE',
      path,
      message: `Invalid local minute integer: ${localMin}`,
    });
  }

  if (!Array.isArray(segs) || segs.length === 0) {
    throw new TimeFoldError({
      code: 'E_SEGMENT_COUNT',
      path: 'segments',
      message: 'Zone segments must be a non-empty array',
    });
  }

  const rawCandidates: number[] = [];

  // O(k), k <= 16: 遍历每段计算 candidate = L* - o_i
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const a_i = parseUtcMinute(seg.startUtc, `segments[${i}].startUtc`);
    const b_i = parseUtcMinute(seg.endUtc, `segments[${i}].endUtc`);
    const candidate = localMin - seg.offsetMinutes;

    // 半开区间判定：a_i <= candidate < b_i
    if (candidate >= a_i && candidate < b_i) {
      rawCandidates.push(candidate);
    }
  }

  // 按 UTC 升序排序
  rawCandidates.sort((a, b) => a - b);

  // 去重
  const deduplicated: number[] = [];
  for (const c of rawCandidates) {
    if (deduplicated.length === 0 || deduplicated[deduplicated.length - 1] !== c) {
      deduplicated.push(c);
    }
  }

  // 自定义表若造成超过两候选，返回 E_AMBIGUITY_GT2 而不是猜测
  if (deduplicated.length > 2) {
    throw new TimeFoldError({
      code: 'E_AMBIGUITY_GT2',
      path,
      message: `Ambiguous local time produced ${deduplicated.length} candidates (exceeding maximum of 2)`,
    });
  }

  return deduplicated;
}

/**
 * 墙上本地时间反像核心：
 * 对输入墙上本地字符串 localLabel (YYYY-MM-DD HH:mm)，
 * 遍历分段计算 candidate = L* - o_i，满足 a_i <= candidate < b_i 时保留，
 * 升序去重，判定 NORMAL (1 候选) / FOLD (2 候选) / GAP (0 候选)。
 *
 * 若落入夏令时向前跳空洞，准确识别其跃迁边界 u_i (gapBoundaryUtc)。
 * 若超过 2 个候选，抛出 E_AMBIGUITY_GT2。
 */
export function mapLocal(
  localLabel: string,
  segs: readonly ZoneSegment[]
): MappingCandidate {
  if (typeof localLabel !== 'string') {
    throw new TimeFoldError({
      code: 'E_INVALID_LOCAL_FORMAT',
      path: 'requestedLocal',
      message: `Expected local date-time string, got ${typeof localLabel}`,
    });
  }

  if (!Array.isArray(segs) || segs.length === 0) {
    throw new TimeFoldError({
      code: 'E_SEGMENT_COUNT',
      path: 'segments',
      message: 'Zone segments must be a non-empty array',
    });
  }

  // 严格解析本地公历字符串为整数分钟 L*
  const localMin = parseLocalMinute(localLabel, 'requestedLocal');

  // 计算候选分钟列表
  const candidateMinutes = findCandidateUtcMinutes(
    localMin,
    segs,
    'requestedLocal'
  );

  if (candidateMinutes.length === 1) {
    const c0 = candidateMinutes[0]!;
    return {
      requestedLocal: localLabel,
      status: 'NORMAL',
      candidatesUtc: [formatUtcMinute(c0)],
      gapBoundaryUtc: null,
    };
  }

  if (candidateMinutes.length === 2) {
    const c0 = candidateMinutes[0]!;
    const c1 = candidateMinutes[1]!;
    return {
      requestedLocal: localLabel,
      status: 'FOLD',
      candidatesUtc: [formatUtcMinute(c0), formatUtcMinute(c1)],
      gapBoundaryUtc: null,
    };
  }

  // 候选数为 0：GAP
  // 查找造成该缺口的分段跃迁边界 u_i = b_i = a_(i+1)
  // 当 o_(i+1) > o_i 时，跳过的当地时间闭左开右区间为 [u_i + o_i, u_i + o_(i+1))
  let gapBoundaryUtc: string | null = null;
  for (let i = 0; i < segs.length - 1; i++) {
    const curSeg = segs[i];
    const nextSeg = segs[i + 1];

    if (nextSeg.offsetMinutes > curSeg.offsetMinutes) {
      const u = parseUtcMinute(curSeg.endUtc, `segments[${i}].endUtc`);
      const gapStartLocal = u + curSeg.offsetMinutes;
      const gapEndLocal = u + nextSeg.offsetMinutes;

      if (localMin >= gapStartLocal && localMin < gapEndLocal) {
        gapBoundaryUtc = formatUtcMinute(u);
        break;
      }
    }
  }

  return {
    requestedLocal: localLabel,
    status: 'GAP',
    candidatesUtc: [],
    gapBoundaryUtc,
  };
}

/**
 * 将 UTC 实例投影为当地墙上时间 (YYYY-MM-DD HH:mm)。
 * 严格按照分段半开区间 [startUtc, endUtc) 查找对应 offsetMinutes，L(t) = t + o_i。
 * 绝不使用系统时区或 Intl。
 */
export function projectUtc(
  instant: number | string,
  segs: readonly ZoneSegment[]
): string {
  if (!Array.isArray(segs) || segs.length === 0) {
    throw new TimeFoldError({
      code: 'E_SEGMENT_COUNT',
      path: 'segments',
      message: 'Zone segments must be a non-empty array',
    });
  }

  const instantMin =
    typeof instant === 'string'
      ? parseUtcMinute(instant, 'instant')
      : instant;

  if (
    typeof instantMin !== 'number' ||
    !Number.isInteger(instantMin) ||
    !Number.isSafeInteger(instantMin)
  ) {
    throw new TimeFoldError({
      code: 'E_INVALID_MINUTE',
      path: 'instantMin',
      message: `Invalid UTC minute: ${instantMin}`,
    });
  }

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const start = parseUtcMinute(seg.startUtc, `segments[${i}].startUtc`);
    const end = parseUtcMinute(seg.endUtc, `segments[${i}].endUtc`);

    if (instantMin >= start && instantMin < end) {
      const localMin = instantMin + seg.offsetMinutes;
      return formatLocalMinute(localMin);
    }
  }

  throw new TimeFoldError({
    code: 'E_OUT_OF_BOUNDS',
    path: 'instantMin',
    message: `UTC minute ${instantMin} is outside all segments`,
  });
}
