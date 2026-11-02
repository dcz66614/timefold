import {
  type Mapping,
  type SelectedMapping,
  type TimeFoldInput,
  TimeFoldError,
} from './types';
import { diffDays, formatUtcMinute, parseUtcMinute } from './calendar';

/**
 * P009 时隙镜 TimeFold — 固定 1440 分钟对照基线与偏差归因
 *
 * 严格遵从 PROJECT_BOOK.md §5.3 与 IMPLEMENTATION_PLAN.md §2.3、TASK-P009-T007。
 *
 * 对照规则：
 * 1. 仅对 daily/weekly 的被请求日期逐日计算；once 为 N/A (baselineUtc: null, driftMinutes: null)。
 * 2. 以第一个实际有选中 UTC 实例的日期为 anchorDate、该日最早被选中 UTC 为 anchorUtc。
 * 3. 对其后第 d 个公历日构造 anchorUtc + d * 1440 分钟。
 * 4. both 的第二分支只作 EXTRA_FOLD_INSTANCE，不参与单值基线比较。
 * 5. 若全部 skip，基线 N/A。
 * 6. driftMinutes = baselineUtc − firstSelectedUtc。正值表示固定间隔对照在绝对时间上更晚。
 */

/**
 * 构建固定 1440 分钟真实间隔基线对照并计算每个请求日期的偏差分钟。
 */
export function buildComparison(
  input: TimeFoldInput,
  selected: readonly SelectedMapping[]
): Mapping[] {
  if (!input || typeof input !== 'object') {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'input',
      message: 'Input must be an object',
    });
  }

  if (!input.schedule || typeof input.schedule !== 'object') {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'input.schedule',
      message: 'Schedule must be an object',
    });
  }

  if (!Array.isArray(selected)) {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'selected',
      message: 'Selected mappings must be an array',
    });
  }

  const { frequency } = input.schedule;

  // 1. frequency === 'once'：对照仅对 daily/weekly 逐日计算，once 永远显示 N/A
  if (frequency === 'once') {
    return selected.map((s) => ({
      requestedLocal: s.requestedLocal,
      status: s.status,
      candidatesUtc: [...s.candidatesUtc],
      selectedUtc: [...s.selectedUtc],
      realizedLocal: [...s.realizedLocal],
      baselineUtc: null,
      driftMinutes: null,
    }));
  }

  // 2. daily / weekly：寻找第一个实际有选中 UTC 实例的日期作为 anchorDate
  let anchorIndex = -1;
  for (let i = 0; i < selected.length; i++) {
    if (selected[i]!.selectedUtc.length > 0) {
      anchorIndex = i;
      break;
    }
  }

  // 若全部 skip（没有任何被选中的实例），基线全部为 N/A
  if (anchorIndex === -1) {
    return selected.map((s) => ({
      requestedLocal: s.requestedLocal,
      status: s.status,
      candidatesUtc: [...s.candidatesUtc],
      selectedUtc: [...s.selectedUtc],
      realizedLocal: [...s.realizedLocal],
      baselineUtc: null,
      driftMinutes: null,
    }));
  }

  const anchorMapping = selected[anchorIndex]!;
  const anchorDate = anchorMapping.requestedLocal.slice(0, 10);
  //最早被选中的 UTC（selectedUtc 已严格升序）
  const anchorUtc = anchorMapping.selectedUtc[0]!;
  const anchorUtcMin = parseUtcMinute(anchorUtc, 'anchorUtc');

  return selected.map((s) => {
    const reqDate = s.requestedLocal.slice(0, 10);
    const d = diffDays(anchorDate, reqDate);

    // 在 anchorDate 之前的日期（如首日被 skip 的情况），因尚未产生 anchor，基线为 N/A
    if (d < 0) {
      return {
        requestedLocal: s.requestedLocal,
        status: s.status,
        candidatesUtc: [...s.candidatesUtc],
        selectedUtc: [...s.selectedUtc],
        realizedLocal: [...s.realizedLocal],
        baselineUtc: null,
        driftMinutes: null,
      };
    }

    // 其后第 d 个公历日构造 anchorUtc + d * 1440 分钟
    const baselineMin = anchorUtcMin + d * 1440;
    const baselineUtc = formatUtcMinute(baselineMin);

    // 计算偏差：driftMinutes = baselineUtc − firstSelectedUtc
    // both 模式下第二分支只显示为 EXTRA_FOLD_INSTANCE，比较时统一使用 firstSelectedUtc (selectedUtc[0])
    let driftMinutes: number | null = null;
    if (s.selectedUtc.length > 0) {
      const firstSelectedUtc = s.selectedUtc[0]!;
      const firstSelectedUtcMin = parseUtcMinute(
        firstSelectedUtc,
        'firstSelectedUtc'
      );
      driftMinutes = baselineMin - firstSelectedUtcMin;
    }

    return {
      requestedLocal: s.requestedLocal,
      status: s.status,
      candidatesUtc: [...s.candidatesUtc],
      selectedUtc: [...s.selectedUtc],
      realizedLocal: [...s.realizedLocal],
      baselineUtc,
      driftMinutes,
    };
  });
}
