/**
 * P009 时隙镜 TimeFold — 权威核心对外导出入口
 *
 * 严格遵从 PROJECT_BOOK.md §5–§6 与 IMPLEMENTATION_PLAN.md §2.3。
 */

// 1. 核心公开纯函数 (IMPLEMENTATION_PLAN.md §2.3 冻结签名)
export { validateInput } from './validate';
export {
  parseUtcMinute,
  formatUtcMinute,
} from './calendar';
export {
  projectUtc,
  mapLocal,
  findCandidateUtcMinutes,
} from './map';
export {
  resolveMapping,
  expandLocalDates,
  expandScheduleMappings,
} from './recurrence';
export { buildComparison } from './compare';
export { findFirstWitness } from './evidence';
export { analyze } from './analyze';

// 2. 权威数据模型与错误类型 (PROJECT_BOOK.md §6 与 types.ts)
export {
  TIMEFOLD_SPEC_SCHEMA,
  TIMEFOLD_RESULT_SCHEMA,
  TIMEFOLD_EXPORT_SCHEMA,
  ZONE_SNAPSHOT_FROZEN_2026,
  type ZoneSegment,
  type ScheduleFrequency,
  type SchedulePolicyGap,
  type SchedulePolicyFold,
  type TimeFoldZone,
  type TimeFoldSchedule,
  type TimeFoldPolicy,
  type TimeFoldInput,
  type MappingStatus,
  type Mapping,
  type EvidenceType,
  type Evidence,
  type AnalysisResult,
  type MappingCandidate,
  type SelectedMapping,
  type AnalysisComputation,
  type TimeFoldExport,
  type TimeFoldErrorDetail,
  TimeFoldError,
} from './types';

// 3. 辅助日历与时间工具 (calendar.ts)
export {
  isLeapYear,
  getDaysInMonth,
  isValidDate,
  isValidTime,
  parseDate,
  formatDate,
  isValidDateString,
  parseTime,
  formatTime,
  isValidTimeString,
  parseLocalMinute,
  formatLocalMinute,
  combineLocalDateAndTime,
  splitLocalMinute,
  addDays,
  diffDays,
  getIsoWeekday,
  compareDateStrings,
} from './calendar';

// 4. 2026 冻结时区快照分段 (zones.ts)
export {
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
  FROZEN_ZONES_BY_LABEL,
  getFrozenZone,
} from './zones';
