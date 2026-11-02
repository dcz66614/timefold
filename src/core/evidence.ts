import {
  type Evidence,
  type EvidenceType,
  type Mapping,
  type TimeFoldInput,
  type ZoneSegment,
  TimeFoldError,
} from './types';
import { parseLocalMinute, parseUtcMinute } from './calendar';

/**
 * P009 时隙镜 TimeFold — 最早见证识别与证据提取
 *
 * 严格遵从 PROJECT_BOOK.md §5.3、§8 MATH08 与 IMPLEMENTATION_PLAN.md §2.3、TASK-P009-T007。
 *
 * 见证规则：
 * 1. 按请求日期升序寻找首个 GAP、FOLD，或首个 driftMinutes ≠ 0 的日期。
 * 2. 同日若同时满足，优先 GAP/FOLD 分类，保留偏移字段。
 * 3. 没有则返回 NONE。
 * 4. 见证必须含分段边界 (boundaryUtc)、请求 (requestedLocal)、候选 (candidatesUtc)、选中值 (selectedUtc) 和基线 (baselineUtc)。
 */

/**
 * 为异常 Mapping 寻找对应的时区分段跃迁边界 (boundaryUtc)。
 */
function findBoundaryUtcForWitness(
  witnessRow: Mapping,
  witnessType: EvidenceType,
  segs: readonly ZoneSegment[],
  anchorUtc: string | null
): string | null {
  if (!Array.isArray(segs) || segs.length <= 1) {
    return null;
  }

  // 1. GAP 见证：寻找导致时钟向前跳空洞的分段跃迁点
  if (witnessType === 'GAP') {
    const localMin = parseLocalMinute(witnessRow.requestedLocal);
    for (let i = 0; i < segs.length - 1; i++) {
      const curSeg = segs[i]!;
      const nextSeg = segs[i + 1]!;
      if (nextSeg.offsetMinutes > curSeg.offsetMinutes) {
        const u = parseUtcMinute(curSeg.endUtc);
        const gapStart = u + curSeg.offsetMinutes;
        const gapEnd = u + nextSeg.offsetMinutes;
        if (localMin >= gapStart && localMin < gapEnd) {
          return curSeg.endUtc;
        }
      }
    }
    // 防御性兜底：返回首个夏令时跃迁点
    for (let i = 0; i < segs.length - 1; i++) {
      if (segs[i + 1]!.offsetMinutes > segs[i]!.offsetMinutes) {
        return segs[i]!.endUtc;
      }
    }
  }

  // 2. FOLD 见证：寻找导致时钟回拨重复折返的分段跃迁点
  if (witnessType === 'FOLD') {
    if (witnessRow.candidatesUtc.length >= 2) {
      const c0Min = parseUtcMinute(witnessRow.candidatesUtc[0]!);
      const c1Min = parseUtcMinute(witnessRow.candidatesUtc[1]!);
      for (let i = 0; i < segs.length - 1; i++) {
        const curSeg = segs[i]!;
        const nextSeg = segs[i + 1]!;
        if (curSeg.offsetMinutes > nextSeg.offsetMinutes) {
          const u = parseUtcMinute(curSeg.endUtc);
          if (c0Min < u && u <= c1Min) {
            return curSeg.endUtc;
          }
        }
      }
    }
    // 兜底：检查 localMin 是否落在回拨区间
    const localMin = parseLocalMinute(witnessRow.requestedLocal);
    for (let i = 0; i < segs.length - 1; i++) {
      const curSeg = segs[i]!;
      const nextSeg = segs[i + 1]!;
      if (curSeg.offsetMinutes > nextSeg.offsetMinutes) {
        const u = parseUtcMinute(curSeg.endUtc);
        const foldStart = u + nextSeg.offsetMinutes;
        const foldEnd = u + curSeg.offsetMinutes;
        if (localMin >= foldStart && localMin < foldEnd) {
          return curSeg.endUtc;
        }
      }
    }
  }

  // 3. DRIFT 见证：寻找导致固定本地计划相对绝对间隔发生偏移的时区跃迁边界
  if (witnessType === 'DRIFT') {
    if (anchorUtc && witnessRow.selectedUtc.length > 0) {
      const anchorMin = parseUtcMinute(anchorUtc);
      const currMin = parseUtcMinute(witnessRow.selectedUtc[0]!);

      // 寻找 anchor 与当前时刻所在的分段索引
      let anchorSegIdx = -1;
      let currSegIdx = -1;
      for (let i = 0; i < segs.length; i++) {
        const start = parseUtcMinute(segs[i]!.startUtc);
        const end = parseUtcMinute(segs[i]!.endUtc);
        if (anchorMin >= start && anchorMin < end) {
          anchorSegIdx = i;
        }
        if (currMin >= start && currMin < end) {
          currSegIdx = i;
        }
      }

      // 若跨越了不同分段，返回导致偏移改变的第一个分段交界点
      if (anchorSegIdx !== -1 && currSegIdx !== -1 && anchorSegIdx !== currSegIdx) {
        const step = anchorSegIdx < currSegIdx ? 1 : -1;
        for (let i = anchorSegIdx; i !== currSegIdx; i += step) {
          const borderIdx = step > 0 ? i : i - 1;
          if (segs[borderIdx]!.offsetMinutes !== segs[borderIdx + 1]!.offsetMinutes) {
            return segs[borderIdx]!.endUtc;
          }
        }
      }
    }

    // 兜底：若在当前行之前存在偏移变化的跃迁点
    if (witnessRow.baselineUtc) {
      const baseMin = parseUtcMinute(witnessRow.baselineUtc);
      for (let i = 0; i < segs.length - 1; i++) {
        const u = parseUtcMinute(segs[i]!.endUtc);
        if (u <= baseMin && segs[i]!.offsetMinutes !== segs[i + 1]!.offsetMinutes) {
          return segs[i]!.endUtc;
        }
      }
    }
  }

  return null;
}

/**
 * 构造人类可读见证解释信息
 */
function buildWitnessMessage(
  type: EvidenceType,
  date: string | null,
  row: Mapping | null
): string {
  if (type === 'NONE' || !row || !date) {
    return 'No gap, fold, or drift detected across schedule occurrences';
  }

  if (type === 'GAP') {
    return `Gap detected at ${row.requestedLocal}: local wall-clock skipped ahead, producing 0 UTC candidates.`;
  }

  if (type === 'FOLD') {
    return `Fold detected at ${row.requestedLocal}: local wall-clock fell back, producing 2 UTC candidates (${row.candidatesUtc.join(', ')}).`;
  }

  if (type === 'DRIFT') {
    const sign = row.driftMinutes! > 0 ? '+' : '';
    return `Drift detected on ${date}: baseline UTC (${row.baselineUtc}) differs by ${sign}${row.driftMinutes} min from wall-clock UTC (${row.selectedUtc[0]}).`;
  }

  return 'Unknown schedule witness condition';
}

/**
 * 按请求日期升序寻找首个 GAP、FOLD 或首个 driftMinutes ≠ 0 的见证
 */
export function findFirstWitness(
  input: TimeFoldInput,
  rows: readonly Mapping[]
): Evidence {
  if (!input || typeof input !== 'object') {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'input',
      message: 'Input must be an object',
    });
  }

  if (!Array.isArray(rows)) {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'rows',
      message: 'Rows must be an array',
    });
  }

  // 记录 anchorUtc，用于 DRIFT 跃迁边界推导
  let anchorUtc: string | null = null;
  for (const r of rows) {
    if (r.selectedUtc.length > 0) {
      anchorUtc = r.selectedUtc[0]!;
      break;
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const isGap = row.status === 'GAP';
    const isFold = row.status === 'FOLD';
    const isDrift = row.driftMinutes !== null && row.driftMinutes !== 0;

    if (isGap || isFold || isDrift) {
      // 优先级：同日若同时满足，优先 GAP/FOLD 分类，保留偏移字段
      let type: EvidenceType;
      if (isGap) {
        type = 'GAP';
      } else if (isFold) {
        type = 'FOLD';
      } else {
        type = 'DRIFT';
      }

      const date = row.requestedLocal.slice(0, 10);
      const boundaryUtc = findBoundaryUtcForWitness(
        row,
        type,
        input.zone.segments,
        anchorUtc
      );
      const message = buildWitnessMessage(type, date, row);

      return {
        type,
        date,
        boundaryUtc,
        message,
        mapping: row,
      };
    }
  }

  // 全程无任何异常
  return {
    type: 'NONE',
    date: null,
    boundaryUtc: null,
    message: buildWitnessMessage('NONE', null, null),
    mapping: null,
  };
}
