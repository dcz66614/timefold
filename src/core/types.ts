/**
 * P009 时隙镜 TimeFold — 权威核心类型契约
 * 严格遵从 PROJECT_BOOK.md §6 与 IMPLEMENTATION_PLAN.md §2.3。
 */

export const TIMEFOLD_SPEC_SCHEMA = 'timefold.spec/1' as const;
export const TIMEFOLD_RESULT_SCHEMA = 'timefold.result/1' as const;
export const TIMEFOLD_EXPORT_SCHEMA = 'timefold.export/1' as const;
export const ZONE_SNAPSHOT_FROZEN_2026 = 'frozen-2026' as const;

/** UTC 分段，半开区间 [startUtc, endUtc)，固定整数偏移分钟 */
export type ZoneSegment = {
  startUtc: string;
  endUtc: string;
  offsetMinutes: number;
};

export type ScheduleFrequency = 'once' | 'daily' | 'weekly';
export type SchedulePolicyGap = 'skip' | 'shiftForward';
export type SchedulePolicyFold = 'earlier' | 'later' | 'both';

export type TimeFoldZone = {
  label: string;
  snapshot: 'frozen-2026';
  segments: ZoneSegment[];
};

export type TimeFoldSchedule = {
  frequency: ScheduleFrequency;
  startDate: string; // YYYY-MM-DD; once: equal
  endDate: string; // YYYY-MM-DD; once: equal
  localTime: string; // HH:mm
  byWeekday: number[]; // weekly: sorted distinct non-empty ISO 1..7; else []
};

export type TimeFoldPolicy = {
  gap: SchedulePolicyGap;
  fold: SchedulePolicyFold;
};

/** 项目书 §6.1 冻结输入规范 */
export type TimeFoldInput = {
  schema: 'timefold.spec/1';
  name: string;
  synthetic: true;
  zone: TimeFoldZone;
  schedule: TimeFoldSchedule;
  policy: TimeFoldPolicy;
};

export type MappingStatus = 'NORMAL' | 'GAP' | 'FOLD';

/** 项目书 §6.1 冻结映射结果行 */
export type Mapping = {
  requestedLocal: string;
  status: MappingStatus;
  candidatesUtc: string[];
  selectedUtc: string[];
  realizedLocal: string[];
  baselineUtc: string | null;
  driftMinutes: number | null;
};

export type EvidenceType = 'GAP' | 'FOLD' | 'DRIFT' | 'NONE';

/** 项目书 §6.1 冻结见证记录 */
export type Evidence = {
  type: EvidenceType;
  date: string | null;
  boundaryUtc: string | null;
  message: string;
  mapping: Mapping | null;
};

/** 项目书 §6.1 冻结分析输出结果 */
export type AnalysisResult = {
  schema: 'timefold.result/1';
  input: TimeFoldInput;
  occurrences: Mapping[];
  requestCount: number;
  selectedCount: number;
  firstWitness: Evidence;
  digest: string; // 纯本地确定性稳定内容摘要；使用 SHA-256 如浏览器可用，非安全认证
};

/** IMPLEMENTATION_PLAN.md §2.3: mapLocal 产出的候选阶段内部结构 */
export type MappingCandidate = {
  requestedLocal: string;
  status: MappingStatus;
  candidatesUtc: string[];
  gapBoundaryUtc: string | null;
};

/** IMPLEMENTATION_PLAN.md §2.3: resolveMapping 策略裁决后的阶段结构 */
export type SelectedMapping = {
  requestedLocal: string;
  status: MappingStatus;
  candidatesUtc: string[];
  selectedUtc: string[];
  realizedLocal: string[];
  gapBoundaryUtc: string | null;
};

/** 同步纯计算分析结果（不含 digest，由 Worker 生成 digest 补齐） */
export type AnalysisComputation = Omit<AnalysisResult, 'digest'>;

/** 导出文件包裹格式 */
export type TimeFoldExport = {
  schema: 'timefold.export/1';
  input: TimeFoldInput;
  result: AnalysisResult;
};

/** 错误详情合同 */
export type TimeFoldErrorDetail = {
  code: string;
  path: string;
  message: string;
};

/** 携带 path/code 的结构化错误 */
export class TimeFoldError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(detail: TimeFoldErrorDetail) {
    super(detail.message);
    this.name = 'TimeFoldError';
    this.code = detail.code;
    this.path = detail.path;
    Object.setPrototypeOf(this, TimeFoldError.prototype);
  }

  toJSON(): TimeFoldErrorDetail {
    return {
      code: this.code,
      path: this.path,
      message: this.message,
    };
  }
}
