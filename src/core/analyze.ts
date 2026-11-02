import {
  type AnalysisComputation,
  type TimeFoldInput,
  TIMEFOLD_RESULT_SCHEMA,
} from './types';
import { validateInput } from './validate';
import { expandScheduleMappings } from './recurrence';
import { buildComparison } from './compare';
import { findFirstWitness } from './evidence';

/**
 * P009 时隙镜 TimeFold — 纯数据分析与汇总核心
 *
 * 严格遵从 PROJECT_BOOK.md §5.3、§6.1 与 IMPLEMENTATION_PLAN.md §2.3、TASK-P009-T007。
 *
 * 特性：
 * - 纯 TypeScript、同步纯计算。
 * - 绝不产生 UI、DOM、网络或外部时间副作用。
 * - 返回不含 digest 的纯数据结构 AnalysisComputation (Omit<AnalysisResult, 'digest'>)。
 * - 由 Worker 另行计算 SHA-256 摘要补齐为最终 AnalysisResult。
 */

/**
 * 执行完整排程反像、策略裁决、基线对照与首个见证分析。
 */
export function analyze(input: TimeFoldInput): AnalysisComputation {
  // 1. 输入防御校验（非法即抛出带 path/code 的 TimeFoldError）
  const validated = validateInput(input);

  // 2. 展开排程请求日期并裁决候选策略
  const selectedMappings = expandScheduleMappings(validated);

  // 3. 构建固定 1440 分钟对照基线并计算逐日偏差
  const occurrences = buildComparison(validated, selectedMappings);

  // 4. 识别首个见证
  const firstWitness = findFirstWitness(validated, occurrences);

  // 5. 统计总请求数与被选中的总 UTC 实例数
  const requestCount = occurrences.length;
  const selectedCount = occurrences.reduce(
    (total, row) => total + row.selectedUtc.length,
    0
  );

  return {
    schema: TIMEFOLD_RESULT_SCHEMA,
    input: validated,
    occurrences,
    requestCount,
    selectedCount,
    firstWitness,
  };
}
