/**
 * P009 时隙镜 TimeFold — 输入规范与分段校验器
 * 严格遵从 PROJECT_BOOK.md §5.4、§5.5、§6.1 与 IMPLEMENTATION_PLAN.md §2.3。
 */

import {
  type TimeFoldInput,
  type TimeFoldSchedule,
  type TimeFoldZone,
  type TimeFoldPolicy,
  type ZoneSegment,
  TIMEFOLD_SPEC_SCHEMA,
  ZONE_SNAPSHOT_FROZEN_2026,
  TimeFoldError,
} from './types';
import {
  parseDate,
  parseTime,
  parseUtcMinute,
  diffDays,
  addDays,
  getIsoWeekday,
} from './calendar';
import { ZONE_START_UTC, ZONE_END_UTC } from './zones';

/** JSON 文本大小上限：256 KiB = 262,144 字节 (PROJECT_BOOK §5.5) */
export const MAX_JSON_BYTES = 256 * 1024;

/** 单次请求排程日期上限：90 个日期 (PROJECT_BOOK §5.3, §5.5) */
export const MAX_REQUEST_DATES = 90;

/** 最大分段数：16 (PROJECT_BOOK §5.1, §5.2) */
export const MAX_SEGMENTS = 16;

/** 最小分段数：1 */
export const MIN_SEGMENTS = 1;

/** 最小偏移分钟：-720 (-12h, PROJECT_BOOK §5.2) */
export const MIN_OFFSET_MINUTES = -720;

/** 最大偏移分钟：+840 (+14h, PROJECT_BOOK §5.2) */
export const MAX_OFFSET_MINUTES = 840;

/** 输入名称最大字符数：80 (PROJECT_BOOK §6.1) */
export const MAX_NAME_LENGTH = 80;

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'schema',
  'name',
  'synthetic',
  'zone',
  'schedule',
  'policy',
]);

const FORBIDDEN_TOP_LEVEL_KEYS = new Set([
  'expectedOutput',
  'isRealBusinessData',
]);

const ALLOWED_ZONE_KEYS = new Set(['label', 'snapshot', 'segments']);
const ALLOWED_SEGMENT_KEYS = new Set(['startUtc', 'endUtc', 'offsetMinutes']);
const ALLOWED_SCHEDULE_KEYS = new Set([
  'frequency',
  'startDate',
  'endDate',
  'localTime',
  'byWeekday',
]);
const ALLOWED_POLICY_KEYS = new Set(['gap', 'fold']);

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * 校验是否存在原型污染字段
 */
function assertNoPrototypePollution(keys: string[], pathPrefix: string = ''): void {
  for (const k of keys) {
    if (DANGEROUS_KEYS.has(k)) {
      const p = pathPrefix ? `${pathPrefix}.${k}` : k;
      throw new TimeFoldError({
        code: 'E_PROTOTYPE_POLLUTION',
        path: p,
        message: `Forbidden prototype pollution property: ${k}`,
      });
    }
  }
}

/**
 * 计算排程实际生成的请求日期数量
 * - once: 1
 * - daily: 跨月闭区间天数差 + 1
 * - weekly: 跨月按 ISO 星期过滤出的匹配日期总数
 */
export function countRequestDates(schedule: TimeFoldSchedule): number {
  if (schedule.frequency === 'once') {
    return 1;
  }
  if (schedule.frequency === 'daily') {
    return diffDays(schedule.startDate, schedule.endDate) + 1;
  }
  if (schedule.frequency === 'weekly') {
    const totalDays = diffDays(schedule.startDate, schedule.endDate);
    let count = 0;
    const weekdaySet = new Set(schedule.byWeekday);
    for (let i = 0; i <= totalDays; i++) {
      const d = addDays(schedule.startDate, i);
      const wd = getIsoWeekday(d);
      if (weekdaySet.has(wd)) {
        count++;
      }
    }
    return count;
  }
  return 0;
}

/**
 * 校验时区分段数组（1..16 段，全覆盖 [ZONE_START_UTC, ZONE_END_UTC)，左闭右开连续无空洞无重叠，相邻偏移不重复）
 */
export function validateZoneSegments(
  segments: unknown,
  pathPrefix: string = 'zone.segments'
): ZoneSegment[] {
  if (!Array.isArray(segments)) {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: pathPrefix,
      message: 'segments must be an array',
    });
  }

  if (segments.length < MIN_SEGMENTS || segments.length > MAX_SEGMENTS) {
    throw new TimeFoldError({
      code: 'E_SEGMENT_COUNT',
      path: pathPrefix,
      message: `segments array must contain between ${MIN_SEGMENTS} and ${MAX_SEGMENTS} segments, got ${segments.length}`,
    });
  }

  const validated: ZoneSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segPath = `${pathPrefix}[${i}]`;

    if (typeof seg !== 'object' || seg === null || Array.isArray(seg)) {
      throw new TimeFoldError({
        code: 'E_INVALID_TYPE',
        path: segPath,
        message: `Segment at index ${i} must be an object`,
      });
    }

    const segKeys = Object.keys(seg);
    assertNoPrototypePollution(segKeys, segPath);

    for (const k of segKeys) {
      if (!ALLOWED_SEGMENT_KEYS.has(k)) {
        throw new TimeFoldError({
          code: 'E_UNKNOWN_PROPERTY',
          path: `${segPath}.${k}`,
          message: `Unknown property "${k}" in segment`,
        });
      }
    }

    for (const req of ['startUtc', 'endUtc', 'offsetMinutes'] as const) {
      if (!(req in seg)) {
        throw new TimeFoldError({
          code: 'E_MISSING_PROPERTY',
          path: `${segPath}.${req}`,
          message: `Missing required property "${req}" in segment`,
        });
      }
    }

    const { startUtc, endUtc, offsetMinutes } = seg as Record<string, unknown>;

    if (typeof startUtc !== 'string') {
      throw new TimeFoldError({
        code: 'E_INVALID_TYPE',
        path: `${segPath}.startUtc`,
        message: 'startUtc must be a string',
      });
    }

    if (typeof endUtc !== 'string') {
      throw new TimeFoldError({
        code: 'E_INVALID_TYPE',
        path: `${segPath}.endUtc`,
        message: 'endUtc must be a string',
      });
    }

    if (
      typeof offsetMinutes !== 'number' ||
      !Number.isInteger(offsetMinutes) ||
      offsetMinutes < MIN_OFFSET_MINUTES ||
      offsetMinutes > MAX_OFFSET_MINUTES
    ) {
      throw new TimeFoldError({
        code: 'E_OFFSET_OUT_OF_RANGE',
        path: `${segPath}.offsetMinutes`,
        message: `offsetMinutes must be an integer between ${MIN_OFFSET_MINUTES} and ${MAX_OFFSET_MINUTES}, got ${offsetMinutes}`,
      });
    }

    const startMin = parseUtcMinute(startUtc, `${segPath}.startUtc`);
    const endMin = parseUtcMinute(endUtc, `${segPath}.endUtc`);

    if (startMin >= endMin) {
      throw new TimeFoldError({
        code: 'E_INVALID_SEGMENT_BOUNDS',
        path: `${segPath}.endUtc`,
        message: `Segment endUtc (${endUtc}) must be strictly after startUtc (${startUtc})`,
      });
    }

    validated.push({
      startUtc,
      endUtc,
      offsetMinutes,
    });
  }

  // 1. 全覆盖起点约束：第一段起点必须严格为 ZONE_START_UTC (2025-12-30T00:00:00Z)
  const firstSeg = validated[0];
  if (!firstSeg || firstSeg.startUtc !== ZONE_START_UTC) {
    throw new TimeFoldError({
      code: 'E_SEGMENT_COVERAGE',
      path: `${pathPrefix}[0].startUtc`,
      message: `First segment startUtc must be ${ZONE_START_UTC}, got ${firstSeg ? firstSeg.startUtc : 'undefined'}`,
    });
  }

  // 2. 全覆盖终点约束：最后一段终点必须严格为 ZONE_END_UTC (2027-01-03T00:00:00Z)
  const lastIndex = validated.length - 1;
  const lastSeg = validated[lastIndex];
  if (!lastSeg || lastSeg.endUtc !== ZONE_END_UTC) {
    throw new TimeFoldError({
      code: 'E_SEGMENT_COVERAGE',
      path: `${pathPrefix}[${lastIndex}].endUtc`,
      message: `Last segment endUtc must be ${ZONE_END_UTC}, got ${lastSeg ? lastSeg.endUtc : 'undefined'}`,
    });
  }

  // 3. 相邻段连续性、空洞、重叠与冗余偏移检查
  for (let i = 0; i < validated.length - 1; i++) {
    const curSeg = validated[i]!;
    const nextSeg = validated[i + 1]!;
    const prevEndMin = parseUtcMinute(curSeg.endUtc, `${pathPrefix}[${i}].endUtc`);
    const nextStartMin = parseUtcMinute(
      nextSeg.startUtc,
      `${pathPrefix}[${i + 1}].startUtc`
    );

    if (nextStartMin > prevEndMin) {
      throw new TimeFoldError({
        code: 'E_SEGMENT_GAP',
        path: `${pathPrefix}[${i + 1}].startUtc`,
        message: `Segment gap detected between segment ${i} end (${curSeg.endUtc}) and segment ${i + 1} start (${nextSeg.startUtc})`,
      });
    }

    if (nextStartMin < prevEndMin) {
      throw new TimeFoldError({
        code: 'E_SEGMENT_OVERLAP',
        path: `${pathPrefix}[${i + 1}].startUtc`,
        message: `Segment overlap detected between segment ${i} end (${curSeg.endUtc}) and segment ${i + 1} start (${nextSeg.startUtc})`,
      });
    }

    if (curSeg.offsetMinutes === nextSeg.offsetMinutes) {
      throw new TimeFoldError({
        code: 'E_REDUNDANT_SEGMENT',
        path: `${pathPrefix}[${i + 1}].offsetMinutes`,
        message: `Adjacent segments ${i} and ${i + 1} have identical offsetMinutes: ${curSeg.offsetMinutes}`,
      });
    }
  }

  return validated;
}

/**
 * 校验 schedule 对象
 */
function validateSchedule(rawSchedule: unknown): TimeFoldSchedule {
  if (
    typeof rawSchedule !== 'object' ||
    rawSchedule === null ||
    Array.isArray(rawSchedule)
  ) {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'schedule',
      message: 'schedule must be an object',
    });
  }

  const schedKeys = Object.keys(rawSchedule);
  assertNoPrototypePollution(schedKeys, 'schedule');

  for (const k of schedKeys) {
    if (!ALLOWED_SCHEDULE_KEYS.has(k)) {
      throw new TimeFoldError({
        code: 'E_UNKNOWN_PROPERTY',
        path: `schedule.${k}`,
        message: `Unknown property "${k}" in schedule`,
      });
    }
  }

  for (const req of [
    'frequency',
    'startDate',
    'endDate',
    'localTime',
    'byWeekday',
  ] as const) {
    if (!(req in rawSchedule)) {
      throw new TimeFoldError({
        code: 'E_MISSING_PROPERTY',
        path: `schedule.${req}`,
        message: `Missing required property "${req}" in schedule`,
      });
    }
  }

  const { frequency, startDate, endDate, localTime, byWeekday } =
    rawSchedule as Record<string, unknown>;

  if (
    frequency !== 'once' &&
    frequency !== 'daily' &&
    frequency !== 'weekly'
  ) {
    throw new TimeFoldError({
      code: 'E_INVALID_FREQUENCY',
      path: 'schedule.frequency',
      message: `Invalid frequency: "${frequency}". Must be 'once', 'daily', or 'weekly'`,
    });
  }

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

  // 严格解析并校验公历日期格式与合法性
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
  } else {
    if (diffDays(startDate, endDate) < 0) {
      throw new TimeFoldError({
        code: 'E_START_DATE_AFTER_END_DATE',
        path: 'schedule.startDate',
        message: `startDate (${startDate}) must not be after endDate (${endDate})`,
      });
    }
  }

  if (typeof localTime !== 'string') {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'schedule.localTime',
      message: 'localTime must be a string',
    });
  }

  // 严格解析并校验本地时间格式与合法性 (00:00..23:59)
  parseTime(localTime, 'schedule.localTime');

  if (!Array.isArray(byWeekday)) {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'schedule.byWeekday',
      message: 'byWeekday must be an array',
    });
  }

  if (frequency === 'once' || frequency === 'daily') {
    if (byWeekday.length > 0) {
      throw new TimeFoldError({
        code: 'E_INVALID_BY_WEEKDAY',
        path: 'schedule.byWeekday',
        message: `byWeekday must be empty array [] for frequency "${frequency}"`,
      });
    }
  } else if (frequency === 'weekly') {
    if (byWeekday.length === 0) {
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
      if (idx > 0 && w <= byWeekday[idx - 1]) {
        throw new TimeFoldError({
          code: 'E_INVALID_BY_WEEKDAY',
          path: `schedule.byWeekday[${idx}]`,
          message: `byWeekday must be strictly sorted distinct integers in 1..7`,
        });
      }
    }
  }

  const typedSchedule: TimeFoldSchedule = {
    frequency,
    startDate,
    endDate,
    localTime,
    byWeekday: [...byWeekday],
  };

  const reqCount = countRequestDates(typedSchedule);
  if (reqCount === 0) {
    throw new TimeFoldError({
      code: 'E_REQUEST_COUNT_EMPTY',
      path: 'schedule',
      message: 'Schedule produces 0 request dates',
    });
  }
  if (reqCount > MAX_REQUEST_DATES) {
    throw new TimeFoldError({
      code: 'E_REQUEST_COUNT_EXCEEDED',
      path: 'schedule',
      message: `Schedule produces ${reqCount} request dates, exceeding maximum limit of ${MAX_REQUEST_DATES}`,
    });
  }

  return typedSchedule;
}

/**
 * 校验 policy 对象
 */
function validatePolicy(rawPolicy: unknown): TimeFoldPolicy {
  if (
    typeof rawPolicy !== 'object' ||
    rawPolicy === null ||
    Array.isArray(rawPolicy)
  ) {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'policy',
      message: 'policy must be an object',
    });
  }

  const polKeys = Object.keys(rawPolicy);
  assertNoPrototypePollution(polKeys, 'policy');

  for (const k of polKeys) {
    if (!ALLOWED_POLICY_KEYS.has(k)) {
      throw new TimeFoldError({
        code: 'E_UNKNOWN_PROPERTY',
        path: `policy.${k}`,
        message: `Unknown property "${k}" in policy`,
      });
    }
  }

  for (const req of ['gap', 'fold'] as const) {
    if (!(req in rawPolicy)) {
      throw new TimeFoldError({
        code: 'E_MISSING_PROPERTY',
        path: `policy.${req}`,
        message: `Missing required property "${req}" in policy`,
      });
    }
  }

  const { gap, fold } = rawPolicy as Record<string, unknown>;

  if (gap !== 'skip' && gap !== 'shiftForward') {
    throw new TimeFoldError({
      code: 'E_INVALID_GAP_POLICY',
      path: 'policy.gap',
      message: `gap policy must be "skip" or "shiftForward", got "${gap}"`,
    });
  }

  if (fold !== 'earlier' && fold !== 'later' && fold !== 'both') {
    throw new TimeFoldError({
      code: 'E_INVALID_FOLD_POLICY',
      path: 'policy.fold',
      message: `fold policy must be "earlier", "later", or "both", got "${fold}"`,
    });
  }

  return {
    gap,
    fold,
  };
}

/**
 * 校验 zone 对象
 */
function validateZone(rawZone: unknown): TimeFoldZone {
  if (typeof rawZone !== 'object' || rawZone === null || Array.isArray(rawZone)) {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'zone',
      message: 'zone must be an object',
    });
  }

  const zoneKeys = Object.keys(rawZone);
  assertNoPrototypePollution(zoneKeys, 'zone');

  for (const k of zoneKeys) {
    if (!ALLOWED_ZONE_KEYS.has(k)) {
      throw new TimeFoldError({
        code: 'E_UNKNOWN_PROPERTY',
        path: `zone.${k}`,
        message: `Unknown property "${k}" in zone`,
      });
    }
  }

  for (const req of ['label', 'snapshot', 'segments'] as const) {
    if (!(req in rawZone)) {
      throw new TimeFoldError({
        code: 'E_MISSING_PROPERTY',
        path: `zone.${req}`,
        message: `Missing required property "${req}" in zone`,
      });
    }
  }

  const { label, snapshot, segments } = rawZone as Record<string, unknown>;

  if (typeof label !== 'string' || label.trim().length === 0 || label.length > MAX_NAME_LENGTH) {
    throw new TimeFoldError({
      code: 'E_INVALID_ZONE_LABEL',
      path: 'zone.label',
      message: `zone.label must be a non-empty string of max ${MAX_NAME_LENGTH} characters`,
    });
  }

  if (snapshot !== ZONE_SNAPSHOT_FROZEN_2026) {
    throw new TimeFoldError({
      code: 'E_INVALID_ZONE_SNAPSHOT',
      path: 'zone.snapshot',
      message: `zone.snapshot must be "${ZONE_SNAPSHOT_FROZEN_2026}", got "${snapshot}"`,
    });
  }

  const validatedSegments = validateZoneSegments(segments, 'zone.segments');

  return {
    label,
    snapshot,
    segments: validatedSegments,
  };
}

/**
 * 对 raw JSON 文本执行 256 KiB 上限与语法校验，并转换为合法 TimeFoldInput
 */
export function validateJsonText(text: string): TimeFoldInput {
  if (typeof text !== 'string') {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: '',
      message: `Expected JSON text string, got ${typeof text}`,
    });
  }

  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > MAX_JSON_BYTES) {
    throw new TimeFoldError({
      code: 'E_JSON_SIZE_EXCEEDED',
      path: '',
      message: `JSON text size (${byteLength} bytes) exceeds maximum limit of 256 KiB (${MAX_JSON_BYTES} bytes)`,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new TimeFoldError({
      code: 'E_JSON_SYNTAX',
      path: '',
      message: `JSON syntax error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return validateInput(parsed);
}

/**
 * 校验完整 TimeFoldInput 对象（纯函数，无副作用，非法时抛出带有 code/path/message 的 TimeFoldError）
 */
export function validateInput(value: unknown): TimeFoldInput {
  if (typeof value === 'string') {
    return validateJsonText(value);
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: '',
      message: 'Input must be a non-null object',
    });
  }

  // 检查序列化后的大小是否超过 256 KiB
  try {
    const serialized = JSON.stringify(value);
    if (serialized && new TextEncoder().encode(serialized).length > MAX_JSON_BYTES) {
      throw new TimeFoldError({
        code: 'E_JSON_SIZE_EXCEEDED',
        path: '',
        message: `Input serialized size exceeds maximum limit of 256 KiB (${MAX_JSON_BYTES} bytes)`,
      });
    }
  } catch (e) {
    if (e instanceof TimeFoldError) throw e;
    // circular reference or unstringifiable
    throw new TimeFoldError({
      code: 'E_JSON_SERIALIZE_FAILED',
      path: '',
      message: 'Input could not be serialized to JSON',
    });
  }

  const topKeys = Object.keys(value);
  assertNoPrototypePollution(topKeys, '');

  // 禁止字段与未知顶层字段校验
  for (const k of topKeys) {
    if (FORBIDDEN_TOP_LEVEL_KEYS.has(k)) {
      throw new TimeFoldError({
        code: 'E_FORBIDDEN_PROPERTY',
        path: k,
        message: `Forbidden property "${k}" in input`,
      });
    }
    if (!ALLOWED_TOP_LEVEL_KEYS.has(k)) {
      throw new TimeFoldError({
        code: 'E_UNKNOWN_PROPERTY',
        path: k,
        message: `Unknown property "${k}" in input`,
      });
    }
  }

  // 必填顶层字段校验
  for (const req of [
    'schema',
    'name',
    'synthetic',
    'zone',
    'schedule',
    'policy',
  ] as const) {
    if (!(req in value)) {
      throw new TimeFoldError({
        code: 'E_MISSING_PROPERTY',
        path: req,
        message: `Missing required property "${req}"`,
      });
    }
  }

  const raw = value as Record<string, unknown>;

  // 1. schema
  if (raw.schema !== TIMEFOLD_SPEC_SCHEMA) {
    throw new TimeFoldError({
      code: 'E_INVALID_SCHEMA',
      path: 'schema',
      message: `Expected schema "${TIMEFOLD_SPEC_SCHEMA}", got "${raw.schema}"`,
    });
  }

  // 2. name
  if (typeof raw.name !== 'string') {
    throw new TimeFoldError({
      code: 'E_INVALID_NAME',
      path: 'name',
      message: 'name must be a string',
    });
  }
  if (raw.name.length > MAX_NAME_LENGTH) {
    throw new TimeFoldError({
      code: 'E_NAME_TOO_LONG',
      path: 'name',
      message: `name exceeds maximum length of ${MAX_NAME_LENGTH} characters, got ${raw.name.length}`,
    });
  }

  // 3. synthetic
  if (raw.synthetic !== true) {
    throw new TimeFoldError({
      code: 'E_INVALID_SYNTHETIC',
      path: 'synthetic',
      message: 'synthetic must be boolean literal true',
    });
  }

  // 4. zone
  const zone = validateZone(raw.zone);

  // 5. schedule
  const schedule = validateSchedule(raw.schedule);

  // 6. policy
  const policy = validatePolicy(raw.policy);

  return {
    schema: TIMEFOLD_SPEC_SCHEMA,
    name: raw.name,
    synthetic: true,
    zone,
    schedule,
    policy,
  };
}
