/**
 * P009-T008 独立数学 Oracle 测试
 *
 * 严格遵从 PROJECT_BOOK.md §5–§8 与 IMPLEMENTATION_PLAN.md §5 T008。
 *
 * 核心原则：
 * 1. 独立性：本测试中的 Oracle 完全基于定义，按 UTC 分钟暴力扫描，
 *    绝不调用、复用或继承 src/core/map.ts 中的任何映射实现（如 mapLocal、findCandidateUtcMinutes 等）。
 * 2. 严禁修改：测试只作为外部独立验证者调用被测内核 (SUT)。
 * 3. 覆盖全量：
 *    - 6 个确定性预设 TF-A 至 TF-F 全量对照；
 *    - 50 个冻结边界/合法范围分钟样本 (SMP-01 至 SMP-50)，覆盖 4 个快照跳变边界前后一分钟、正常日、跨月样本；
 *    - 对 0/1/2 候选及跳变边界精确断言。
 */

import { describe, expect, it } from 'vitest';
import type { TimeFoldInput, ZoneSegment, AnalysisComputation } from '../../src/core/types';
import {
  NEW_YORK_SEGMENTS,
  LONDON_SEGMENTS,
  TOKYO_SEGMENTS,
  UTC_SEGMENTS,
} from '../../src/core/zones';

// 被测对象 (Subject Under Test) — 仅作为待测黑盒引入
import { mapLocal as sutMapLocal } from '../../src/core/map';
import { analyze as sutAnalyze } from '../../src/core/analyze';

/* ==========================================================================
 * 1. 独立 Oracle 实现（纯整数分钟与暴力扫描，不依赖 src/core/map.ts）
 * ========================================================================== */

/** 独立解析 ISO UTC 字符串为自 1970-01-01 以来的整数分钟 */
export function independentParseIsoUtc(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(iso);
  if (!match) {
    throw new Error(`[Oracle] Invalid ISO UTC string: ${iso}`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const hh = Number(match[4]);
  const mm = Number(match[5]);
  const ss = Number(match[6]);
  if (ss !== 0) {
    throw new Error(`[Oracle] Non-zero second in UTC string: ${iso}`);
  }
  const ms = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  return Math.floor(ms / 60000);
}

/** 独立格式化整数 UTC 分钟为 ISO UTC 字符串 */
export function independentFormatIsoUtc(epochMin: number): string {
  const d = new Date(epochMin * 60000);
  return d.toISOString().slice(0, 19) + 'Z';
}

/** 独立解析本地公历字符串 (YYYY-MM-DD HH:mm) 为公历民用分钟数 */
export function independentParseCivilLocal(localStr: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(localStr);
  if (!match) {
    throw new Error(`[Oracle] Invalid local date-time string: ${localStr}`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const hh = Number(match[4]);
  const mm = Number(match[5]);
  const ms = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  return Math.floor(ms / 60000);
}

/** 独立格式化公历民用分钟为 YYYY-MM-DD HH:mm */
export function independentFormatCivilLocal(epochMin: number): string {
  const d = new Date(epochMin * 60000);
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** 独立 Oracle 的映射结果结构 */
export interface OracleMappingResult {
  requestedLocal: string;
  status: 'NORMAL' | 'FOLD' | 'GAP';
  candidatesUtc: string[];
  gapBoundaryUtc: string | null;
}

/**
 * 独立 Oracle：按 UTC 分钟暴力扫描候选
 *
 * 算法原理：
 * 1. 给定目标墙上时间 L*（以民用分钟表示）。
 * 2. 查验分段表，找出所有分段的最小偏移与最大偏移。
 * 3. 候选 t（UTC 分钟）若满足 t + offset = L*，必然落在区间 [L* - maxOffset - 60, L* - minOffset + 60] 内。
 * 4. 暴力遍历该区间内每一个整数 UTC 分钟 t：
 *    - 检查 t 落入哪一个分段 S_i = [A_i, B_i)（半开区间）；
 *    - 若落入 S_i，则计算本地民用分钟 L(t) = t + S_i.offsetMinutes；
 *    - 若 L(t) === L*，则 t 是一个候选 UTC 分钟。
 * 5. 排序去重候选 t；
 * 6. 若候选数 > 2，报歧义错误；
 * 7. 若候选数 === 1，判定 NORMAL；
 * 8. 若候选数 === 2，判定 FOLD；
 * 9. 若候选数 === 0，判定 GAP，并检查是否属于某次正向跳变空洞 [u + o_i, u + o_{i+1})，识别 gapBoundaryUtc。
 */
export function oracleMapLocal(
  localLabel: string,
  segments: readonly ZoneSegment[]
): OracleMappingResult {
  if (segments.length === 0) {
    throw new Error('[Oracle] Segments must not be empty');
  }

  const targetLocalMin = independentParseCivilLocal(localLabel);

  const parsedSegs = segments.map((seg, idx) => ({
    index: idx,
    startMin: independentParseIsoUtc(seg.startUtc),
    endMin: independentParseIsoUtc(seg.endUtc),
    offsetMinutes: seg.offsetMinutes,
  }));

  let minOffset = Infinity;
  let maxOffset = -Infinity;
  for (const s of parsedSegs) {
    if (s.offsetMinutes < minOffset) minOffset = s.offsetMinutes;
    if (s.offsetMinutes > maxOffset) maxOffset = s.offsetMinutes;
  }

  // 严格安全的搜索窗口，左右各放宽 1440 分钟（整整一天容差，确保绝无漏扫）
  const tMin = targetLocalMin - maxOffset - 1440;
  const tMax = targetLocalMin - minOffset + 1440;

  const foundUtcMinutes: number[] = [];

  for (let t = tMin; t <= tMax; t++) {
    // 判定 t 属于哪个分段：左闭右开 [startMin, endMin)
    for (const seg of parsedSegs) {
      if (t >= seg.startMin && t < seg.endMin) {
        const localFromT = t + seg.offsetMinutes;
        if (localFromT === targetLocalMin) {
          foundUtcMinutes.push(t);
        }
        break; // 每个 t 仅属于唯一分段
      }
    }
  }

  // 升序与去重
  foundUtcMinutes.sort((a, b) => a - b);
  const candidates: number[] = [];
  for (const c of foundUtcMinutes) {
    if (candidates.length === 0 || candidates[candidates.length - 1] !== c) {
      candidates.push(c);
    }
  }

  if (candidates.length > 2) {
    throw new Error(`[Oracle] E_AMBIGUITY_GT2: found ${candidates.length} candidates`);
  }

  if (candidates.length === 1) {
    return {
      requestedLocal: localLabel,
      status: 'NORMAL',
      candidatesUtc: [independentFormatIsoUtc(candidates[0]!)],
      gapBoundaryUtc: null,
    };
  }

  if (candidates.length === 2) {
    return {
      requestedLocal: localLabel,
      status: 'FOLD',
      candidatesUtc: [
        independentFormatIsoUtc(candidates[0]!),
        independentFormatIsoUtc(candidates[1]!),
      ],
      gapBoundaryUtc: null,
    };
  }

  // 候选为 0: GAP
  let gapBoundaryUtc: string | null = null;
  for (let i = 0; i < parsedSegs.length - 1; i++) {
    const cur = parsedSegs[i]!;
    const next = parsedSegs[i + 1]!;
    if (next.offsetMinutes > cur.offsetMinutes) {
      const u = cur.endMin; // 跳变点 UTC 分钟
      const gapStart = u + cur.offsetMinutes;
      const gapEnd = u + next.offsetMinutes;
      if (targetLocalMin >= gapStart && targetLocalMin < gapEnd) {
        gapBoundaryUtc = independentFormatIsoUtc(u);
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

/** 独立 Oracle 将 UTC 实例投影为本地时间 */
export function oracleProjectUtc(
  utcIso: string,
  segments: readonly ZoneSegment[]
): string {
  const utcMin = independentParseIsoUtc(utcIso);
  for (const seg of segments) {
    const s = independentParseIsoUtc(seg.startUtc);
    const e = independentParseIsoUtc(seg.endUtc);
    if (utcMin >= s && utcMin < e) {
      const localMin = utcMin + seg.offsetMinutes;
      return independentFormatCivilLocal(localMin);
    }
  }
  throw new Error(`[Oracle] UTC minute ${utcIso} outside all segments`);
}

/* ==========================================================================
 * 2. 六个确定性预设定义 (TF-A 至 TF-F)
 * ========================================================================== */

export const PRESET_TF_A: TimeFoldInput = {
  schema: 'timefold.spec/1',
  name: 'TF-A Spring Gap',
  synthetic: true,
  zone: {
    label: 'America/New_York',
    snapshot: 'frozen-2026',
    segments: [...NEW_YORK_SEGMENTS],
  },
  schedule: {
    frequency: 'once',
    startDate: '2026-03-08',
    endDate: '2026-03-08',
    localTime: '02:30',
    byWeekday: [],
  },
  policy: {
    gap: 'skip',
    fold: 'earlier',
  },
};

export const PRESET_TF_B: TimeFoldInput = {
  schema: 'timefold.spec/1',
  name: 'TF-B New York Fall Fold',
  synthetic: true,
  zone: {
    label: 'America/New_York',
    snapshot: 'frozen-2026',
    segments: [...NEW_YORK_SEGMENTS],
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

export const PRESET_TF_C: TimeFoldInput = {
  schema: 'timefold.spec/1',
  name: 'TF-C London Spring Gap',
  synthetic: true,
  zone: {
    label: 'Europe/London',
    snapshot: 'frozen-2026',
    segments: [...LONDON_SEGMENTS],
  },
  schedule: {
    frequency: 'once',
    startDate: '2026-03-29',
    endDate: '2026-03-29',
    localTime: '01:30',
    byWeekday: [],
  },
  policy: {
    gap: 'skip',
    fold: 'earlier',
  },
};

export const PRESET_TF_D: TimeFoldInput = {
  schema: 'timefold.spec/1',
  name: 'TF-D London Fall Fold',
  synthetic: true,
  zone: {
    label: 'Europe/London',
    snapshot: 'frozen-2026',
    segments: [...LONDON_SEGMENTS],
  },
  schedule: {
    frequency: 'once',
    startDate: '2026-10-25',
    endDate: '2026-10-25',
    localTime: '01:30',
    byWeekday: [],
  },
  policy: {
    gap: 'skip',
    fold: 'both',
  },
};

export const PRESET_TF_E: TimeFoldInput = {
  schema: 'timefold.spec/1',
  name: 'TF-E Tokyo Daily',
  synthetic: true,
  zone: {
    label: 'Asia/Tokyo',
    snapshot: 'frozen-2026',
    segments: [...TOKYO_SEGMENTS],
  },
  schedule: {
    frequency: 'daily',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    localTime: '09:00',
    byWeekday: [],
  },
  policy: {
    gap: 'skip',
    fold: 'earlier',
  },
};

export const PRESET_TF_F: TimeFoldInput = {
  schema: 'timefold.spec/1',
  name: 'TF-F Fixed Interval Drift',
  synthetic: true,
  zone: {
    label: 'America/New_York',
    snapshot: 'frozen-2026',
    segments: [...NEW_YORK_SEGMENTS],
  },
  schedule: {
    frequency: 'weekly',
    startDate: '2026-03-02',
    endDate: '2026-03-23',
    localTime: '09:00',
    byWeekday: [1],
  },
  policy: {
    gap: 'skip',
    fold: 'earlier',
  },
};

/* ==========================================================================
 * 3. 50 个冻结边界/合法范围分钟样本 (SMP-01 至 SMP-50)
 * ========================================================================== */

export interface FrozenSample {
  id: string;
  category: string;
  zoneLabel: string;
  segments: readonly ZoneSegment[];
  localMinute: string;
  description: string;
}

export const FROZEN_BOUNDARY_SAMPLES: readonly FrozenSample[] = [
  // 1. New York Spring Gap 跳变边界及周围 (2026-03-08T07:00:00Z: EST -300 -> EDT -240)
  {
    id: 'SMP-01',
    category: 'NY Spring Gap Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-03-08 01:59',
    description: '跳变前一分钟 (EST -300min)',
  },
  {
    id: 'SMP-02',
    category: 'NY Spring Gap Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-03-08 02:00',
    description: '空洞起始时刻 (精确跳变边界对应当地时间)',
  },
  {
    id: 'SMP-03',
    category: 'NY Spring Gap Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-03-08 02:01',
    description: '空洞起始后一分钟',
  },
  {
    id: 'SMP-04',
    category: 'NY Spring Gap Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-03-08 02:30',
    description: '空洞正中（TF-A 黄金样本）',
  },
  {
    id: 'SMP-05',
    category: 'NY Spring Gap Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-03-08 02:59',
    description: '空洞最后一分钟',
  },
  {
    id: 'SMP-06',
    category: 'NY Spring Gap Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-03-08 03:00',
    description: '跳变恢复起始时刻 (EDT -240min)',
  },
  {
    id: 'SMP-07',
    category: 'NY Spring Gap Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-03-08 03:01',
    description: '跳变恢复后一分钟 (EDT -240min)',
  },

  // 2. New York Fall Fold 跳变边界及周围 (2026-11-01T06:00:00Z: EDT -240 -> EST -300)
  {
    id: 'SMP-08',
    category: 'NY Fall Fold Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-11-01 00:59',
    description: '回拨前一分钟 (EDT -240min)',
  },
  {
    id: 'SMP-09',
    category: 'NY Fall Fold Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-11-01 01:00',
    description: '回拨重叠起始时刻 (二重候选起点)',
  },
  {
    id: 'SMP-10',
    category: 'NY Fall Fold Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-11-01 01:01',
    description: '重叠区间内一分钟',
  },
  {
    id: 'SMP-11',
    category: 'NY Fall Fold Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-11-01 01:30',
    description: '回拨重叠正中（TF-B 黄金样本）',
  },
  {
    id: 'SMP-12',
    category: 'NY Fall Fold Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-11-01 01:59',
    description: '回拨重叠最后一分钟',
  },
  {
    id: 'SMP-13',
    category: 'NY Fall Fold Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-11-01 02:00',
    description: '重叠结束恢复常态时刻 (EST -300min)',
  },
  {
    id: 'SMP-14',
    category: 'NY Fall Fold Boundary',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-11-01 02:01',
    description: '恢复常态后一分钟 (EST -300min)',
  },

  // 3. London Spring Gap 跳变边界及周围 (2026-03-29T01:00:00Z: GMT 0 -> BST +60)
  {
    id: 'SMP-15',
    category: 'London Spring Gap Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-03-29 00:59',
    description: '伦敦跳变前一分钟 (GMT 0min)',
  },
  {
    id: 'SMP-16',
    category: 'London Spring Gap Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-03-29 01:00',
    description: '伦敦空洞起始时刻 (01:00Z GMT)',
  },
  {
    id: 'SMP-17',
    category: 'London Spring Gap Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-03-29 01:01',
    description: '伦敦空洞内一分钟',
  },
  {
    id: 'SMP-18',
    category: 'London Spring Gap Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-03-29 01:30',
    description: '伦敦空洞正中（TF-C 黄金样本）',
  },
  {
    id: 'SMP-19',
    category: 'London Spring Gap Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-03-29 01:59',
    description: '伦敦空洞最后一分钟',
  },
  {
    id: 'SMP-20',
    category: 'London Spring Gap Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-03-29 02:00',
    description: '伦敦跳变恢复时刻 (BST +60min)',
  },
  {
    id: 'SMP-21',
    category: 'London Spring Gap Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-03-29 02:01',
    description: '伦敦跳变恢复后一分钟 (BST +60min)',
  },

  // 4. London Fall Fold 跳变边界及周围 (2026-10-25T01:00:00Z: BST +60 -> GMT 0)
  {
    id: 'SMP-22',
    category: 'London Fall Fold Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-10-25 00:59',
    description: '伦敦回拨前一分钟 (BST +60min)',
  },
  {
    id: 'SMP-23',
    category: 'London Fall Fold Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-10-25 01:00',
    description: '伦敦回拨重叠起始时刻',
  },
  {
    id: 'SMP-24',
    category: 'London Fall Fold Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-10-25 01:01',
    description: '伦敦回拨重叠内一分钟',
  },
  {
    id: 'SMP-25',
    category: 'London Fall Fold Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-10-25 01:30',
    description: '伦敦回拨重叠正中（TF-D 黄金样本）',
  },
  {
    id: 'SMP-26',
    category: 'London Fall Fold Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-10-25 01:59',
    description: '伦敦回拨重叠最后一分钟',
  },
  {
    id: 'SMP-27',
    category: 'London Fall Fold Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-10-25 02:00',
    description: '伦敦回拨结束恢复常态时刻 (GMT 0min)',
  },
  {
    id: 'SMP-28',
    category: 'London Fall Fold Boundary',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-10-25 02:01',
    description: '伦敦恢复常态后一分钟 (GMT 0min)',
  },

  // 5. New York 常态日与跨月样本
  {
    id: 'SMP-29',
    category: 'NY Normal & Cross-Month',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-01-15 12:00',
    description: '纽约冬季正午常态 (EST -300min)',
  },
  {
    id: 'SMP-30',
    category: 'NY Normal & Cross-Month',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-02-28 23:59',
    description: '纽约跨月：平年 2 月最后一分钟',
  },
  {
    id: 'SMP-31',
    category: 'NY Normal & Cross-Month',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-03-01 00:00',
    description: '纽约跨月：3 月第一分钟',
  },
  {
    id: 'SMP-32',
    category: 'NY Normal & Cross-Month',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-06-15 12:00',
    description: '纽约夏季正午常态 (EDT -240min)',
  },
  {
    id: 'SMP-33',
    category: 'NY Normal & Cross-Month',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-10-31 23:59',
    description: '纽约跨月：10 月最后一分钟（回拨日前夕）',
  },
  {
    id: 'SMP-34',
    category: 'NY Normal & Cross-Month',
    zoneLabel: 'America/New_York',
    segments: NEW_YORK_SEGMENTS,
    localMinute: '2026-12-31 23:59',
    description: '纽约年终最后一分钟',
  },

  // 6. London 常态日与跨月样本
  {
    id: 'SMP-35',
    category: 'London Normal & Cross-Month',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-01-15 12:00',
    description: '伦敦冬季正午常态 (GMT 0min)',
  },
  {
    id: 'SMP-36',
    category: 'London Normal & Cross-Month',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-02-28 23:59',
    description: '伦敦跨月：平年 2 月最后一分钟',
  },
  {
    id: 'SMP-37',
    category: 'London Normal & Cross-Month',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-03-01 00:00',
    description: '伦敦跨月：3 月第一分钟',
  },
  {
    id: 'SMP-38',
    category: 'London Normal & Cross-Month',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-07-15 12:00',
    description: '伦敦夏季正午常态 (BST +60min)',
  },
  {
    id: 'SMP-39',
    category: 'London Normal & Cross-Month',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-08-31 23:59',
    description: '伦敦跨月：8 月最后一分钟 (BST)',
  },
  {
    id: 'SMP-40',
    category: 'London Normal & Cross-Month',
    zoneLabel: 'Europe/London',
    segments: LONDON_SEGMENTS,
    localMinute: '2026-09-01 00:00',
    description: '伦敦跨月：9 月第一分钟 (BST)',
  },

  // 7. Tokyo 常态日与跨月样本（全时段固定 +540min，无夏令时）
  {
    id: 'SMP-41',
    category: 'Tokyo Normal & Cross-Month',
    zoneLabel: 'Asia/Tokyo',
    segments: TOKYO_SEGMENTS,
    localMinute: '2026-01-01 09:00',
    description: '东京元旦晨间 (JST +540min -> 00:00Z)',
  },
  {
    id: 'SMP-42',
    category: 'Tokyo Normal & Cross-Month',
    zoneLabel: 'Asia/Tokyo',
    segments: TOKYO_SEGMENTS,
    localMinute: '2026-02-28 23:59',
    description: '东京跨月：平年 2 月最后一分钟',
  },
  {
    id: 'SMP-43',
    category: 'Tokyo Normal & Cross-Month',
    zoneLabel: 'Asia/Tokyo',
    segments: TOKYO_SEGMENTS,
    localMinute: '2026-03-01 00:00',
    description: '东京跨月：3 月第一分钟',
  },
  {
    id: 'SMP-44',
    category: 'Tokyo Normal & Cross-Month',
    zoneLabel: 'Asia/Tokyo',
    segments: TOKYO_SEGMENTS,
    localMinute: '2026-06-01 09:00',
    description: '东京常态日（TF-E 第一日，精确 00:00Z）',
  },
  {
    id: 'SMP-45',
    category: 'Tokyo Normal & Cross-Month',
    zoneLabel: 'Asia/Tokyo',
    segments: TOKYO_SEGMENTS,
    localMinute: '2026-12-31 23:59',
    description: '东京年终最后一分钟',
  },

  // 8. UTC 常态日与跨月样本（全程 0 偏移）
  {
    id: 'SMP-46',
    category: 'UTC Normal & Cross-Month',
    zoneLabel: 'UTC',
    segments: UTC_SEGMENTS,
    localMinute: '2026-01-01 00:00',
    description: 'UTC 元旦零点',
  },
  {
    id: 'SMP-47',
    category: 'UTC Normal & Cross-Month',
    zoneLabel: 'UTC',
    segments: UTC_SEGMENTS,
    localMinute: '2026-02-28 23:59',
    description: 'UTC 跨月：平年 2 月最后一分钟',
  },
  {
    id: 'SMP-48',
    category: 'UTC Normal & Cross-Month',
    zoneLabel: 'UTC',
    segments: UTC_SEGMENTS,
    localMinute: '2026-03-01 00:00',
    description: 'UTC 跨月：3 月第一分钟',
  },
  {
    id: 'SMP-49',
    category: 'UTC Normal & Cross-Month',
    zoneLabel: 'UTC',
    segments: UTC_SEGMENTS,
    localMinute: '2026-06-15 12:00',
    description: 'UTC 年中正午',
  },
  {
    id: 'SMP-50',
    category: 'UTC Normal & Cross-Month',
    zoneLabel: 'UTC',
    segments: UTC_SEGMENTS,
    localMinute: '2026-12-31 23:59',
    description: 'UTC 年终最后一分钟',
  },
];

/* ==========================================================================
 * 4. Vitest 测试套件：独立 Oracle 验证
 * ========================================================================== */

describe('TASK-P009-T008 独立数学 Oracle 验证套件 (MATH09)', () => {
  describe('4.1 六个确定性预设全量对照 (TF-A 至 TF-F)', () => {
    it('TF-A (春季缺口): 独立 Oracle 判定 GAP，候选 0；shiftForward 精确到 07:00Z / 03:00 local', () => {
      // 1. 独立 Oracle 验证映射
      const oracleRes = oracleMapLocal('2026-03-08 02:30', NEW_YORK_SEGMENTS);
      expect(oracleRes.status).toBe('GAP');
      expect(oracleRes.candidatesUtc).toEqual([]);
      expect(oracleRes.gapBoundaryUtc).toBe('2026-03-08T07:00:00Z');

      // 2. 与内核 mapLocal 比较
      const coreMap = sutMapLocal('2026-03-08 02:30', NEW_YORK_SEGMENTS);
      expect(coreMap.status).toBe(oracleRes.status);
      expect(coreMap.candidatesUtc).toEqual(oracleRes.candidatesUtc);
      expect(coreMap.gapBoundaryUtc).toBe(oracleRes.gapBoundaryUtc);

      // 3. 策略 skip 模式下的内核 analyze
      const resSkip = sutAnalyze(PRESET_TF_A);
      expect(resSkip.occurrences[0]?.status).toBe('GAP');
      expect(resSkip.occurrences[0]?.selectedUtc).toEqual([]);
      expect(resSkip.selectedCount).toBe(0);
      expect(resSkip.firstWitness.type).toBe('GAP');
      expect(resSkip.firstWitness.boundaryUtc).toBe('2026-03-08T07:00:00Z');

      // 4. 策略 shiftForward 模式下的内核 analyze
      const tfAShift: TimeFoldInput = {
        ...PRESET_TF_A,
        policy: { gap: 'shiftForward', fold: 'earlier' },
      };
      const resShift = sutAnalyze(tfAShift);
      expect(resShift.occurrences[0]?.status).toBe('GAP');
      expect(resShift.occurrences[0]?.selectedUtc).toEqual(['2026-03-08T07:00:00Z']);
      expect(resShift.occurrences[0]?.realizedLocal).toEqual(['2026-03-08 03:00']);
      expect(resShift.selectedCount).toBe(1);
    });

    it('TF-B (双生一刻): 独立 Oracle 判定 FOLD，严格两候选且差 60 分钟；both/earlier/later 策略正确', () => {
      // 1. 独立 Oracle 暴力遍历
      const oracleRes = oracleMapLocal('2026-11-01 01:30', NEW_YORK_SEGMENTS);
      expect(oracleRes.status).toBe('FOLD');
      expect(oracleRes.candidatesUtc).toEqual([
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
      ]);
      expect(oracleRes.gapBoundaryUtc).toBeNull();

      // 差值验证：精确 60 分钟
      const t0 = independentParseIsoUtc(oracleRes.candidatesUtc[0]!);
      const t1 = independentParseIsoUtc(oracleRes.candidatesUtc[1]!);
      expect(t1 - t0).toBe(60);

      // 2. 与内核 mapLocal 比较
      const coreMap = sutMapLocal('2026-11-01 01:30', NEW_YORK_SEGMENTS);
      expect(coreMap).toEqual(oracleRes);

      // 3. 策略 fold: both
      const resBoth = sutAnalyze(PRESET_TF_B);
      expect(resBoth.occurrences[0]?.status).toBe('FOLD');
      expect(resBoth.occurrences[0]?.candidatesUtc).toEqual(oracleRes.candidatesUtc);
      expect(resBoth.occurrences[0]?.selectedUtc).toEqual(oracleRes.candidatesUtc);
      expect(resBoth.selectedCount).toBe(2);
      expect(resBoth.firstWitness.type).toBe('FOLD');

      // 4. 策略 fold: earlier
      const resEarlier = sutAnalyze({
        ...PRESET_TF_B,
        policy: { gap: 'skip', fold: 'earlier' },
      });
      expect(resEarlier.occurrences[0]?.selectedUtc).toEqual(['2026-11-01T05:30:00Z']);
      expect(resEarlier.selectedCount).toBe(1);

      // 5. 策略 fold: later
      const resLater = sutAnalyze({
        ...PRESET_TF_B,
        policy: { gap: 'skip', fold: 'later' },
      });
      expect(resLater.occurrences[0]?.selectedUtc).toEqual(['2026-11-01T06:30:00Z']);
      expect(resLater.selectedCount).toBe(1);
    });

    it('TF-C (伦敦缺口): 独立 Oracle 判定 GAP，候选 0；shiftForward 精确到 01:00Z / 02:00 local', () => {
      const oracleRes = oracleMapLocal('2026-03-29 01:30', LONDON_SEGMENTS);
      expect(oracleRes.status).toBe('GAP');
      expect(oracleRes.candidatesUtc).toEqual([]);
      expect(oracleRes.gapBoundaryUtc).toBe('2026-03-29T01:00:00Z');

      const coreMap = sutMapLocal('2026-03-29 01:30', LONDON_SEGMENTS);
      expect(coreMap).toEqual(oracleRes);

      const resSkip = sutAnalyze(PRESET_TF_C);
      expect(resSkip.occurrences[0]?.status).toBe('GAP');
      expect(resSkip.occurrences[0]?.selectedUtc).toEqual([]);

      const resShift = sutAnalyze({
        ...PRESET_TF_C,
        policy: { gap: 'shiftForward', fold: 'earlier' },
      });
      expect(resShift.occurrences[0]?.selectedUtc).toEqual(['2026-03-29T01:00:00Z']);
      expect(resShift.occurrences[0]?.realizedLocal).toEqual(['2026-03-29 02:00']);
    });

    it('TF-D (伦敦重叠): 独立 Oracle 判定 FOLD，候选 00:30Z 与 01:30Z，差 60 分钟', () => {
      const oracleRes = oracleMapLocal('2026-10-25 01:30', LONDON_SEGMENTS);
      expect(oracleRes.status).toBe('FOLD');
      expect(oracleRes.candidatesUtc).toEqual([
        '2026-10-25T00:30:00Z',
        '2026-10-25T01:30:00Z',
      ]);

      const coreMap = sutMapLocal('2026-10-25 01:30', LONDON_SEGMENTS);
      expect(coreMap).toEqual(oracleRes);

      const resBoth = sutAnalyze(PRESET_TF_D);
      expect(resBoth.occurrences[0]?.status).toBe('FOLD');
      expect(resBoth.occurrences[0]?.selectedUtc).toEqual(oracleRes.candidatesUtc);
      expect(resBoth.selectedCount).toBe(2);
    });

    it('TF-E (东京常态): 独立 Oracle 判定 3 日均为 NORMAL，UTC 均为 00:00Z，firstWitness=NONE', () => {
      const dates = ['2026-06-01', '2026-06-02', '2026-06-03'];
      for (const d of dates) {
        const local = `${d} 09:00`;
        const oracleRes = oracleMapLocal(local, TOKYO_SEGMENTS);
        expect(oracleRes.status).toBe('NORMAL');
        expect(oracleRes.candidatesUtc).toEqual([`${d}T00:00:00Z`]);

        const coreMap = sutMapLocal(local, TOKYO_SEGMENTS);
        expect(coreMap).toEqual(oracleRes);
      }

      const res = sutAnalyze(PRESET_TF_E);
      expect(res.requestCount).toBe(3);
      expect(res.selectedCount).toBe(3);
      expect(res.firstWitness.type).toBe('NONE');
      for (let i = 0; i < 3; i++) {
        expect(res.occurrences[i]?.driftMinutes).toBe(0);
        expect(res.occurrences[i]?.status).toBe('NORMAL');
      }
    });

    it('TF-F (固定间隔漂移): 4 个周一实例，首个漂移 2026-03-09 (+60min)，与独立 Oracle 扫描一致', () => {
      const mondays = [
        { date: '2026-03-02', expectedUtc: '2026-03-02T14:00:00Z', drift: 0 },
        { date: '2026-03-09', expectedUtc: '2026-03-09T13:00:00Z', drift: 60 },
        { date: '2026-03-16', expectedUtc: '2026-03-16T13:00:00Z', drift: 60 },
        { date: '2026-03-23', expectedUtc: '2026-03-23T13:00:00Z', drift: 60 },
      ];

      for (const m of mondays) {
        const local = `${m.date} 09:00`;
        const oracleRes = oracleMapLocal(local, NEW_YORK_SEGMENTS);
        expect(oracleRes.status).toBe('NORMAL');
        expect(oracleRes.candidatesUtc).toEqual([m.expectedUtc]);

        const coreMap = sutMapLocal(local, NEW_YORK_SEGMENTS);
        expect(coreMap).toEqual(oracleRes);
      }

      const res = sutAnalyze(PRESET_TF_F);
      expect(res.firstWitness.type).toBe('DRIFT');
      expect(res.firstWitness.date).toBe('2026-03-09');
      expect(res.firstWitness.boundaryUtc).toBe('2026-03-08T07:00:00Z');
      expect(res.firstWitness.mapping?.driftMinutes).toBe(60);
    });
  });

  describe('4.2 50 个冻结边界/合法范围分钟样本逐一比对 (SMP-01 至 SMP-50)', () => {
    it('全部 50 个样本由独立 Oracle 暴力遍历计算，并与内核 mapLocal 达成零容差完全一致', () => {
      expect(FROZEN_BOUNDARY_SAMPLES.length).toBe(50);

      const discrepancies: Array<{
        id: string;
        local: string;
        oracle: OracleMappingResult;
        core: unknown;
      }> = [];

      for (const sample of FROZEN_BOUNDARY_SAMPLES) {
        const oracleRes = oracleMapLocal(sample.localMinute, sample.segments);
        const coreRes = sutMapLocal(sample.localMinute, sample.segments);

        if (
          oracleRes.status !== coreRes.status ||
          oracleRes.requestedLocal !== coreRes.requestedLocal ||
          oracleRes.gapBoundaryUtc !== coreRes.gapBoundaryUtc ||
          oracleRes.candidatesUtc.length !== coreRes.candidatesUtc.length ||
          oracleRes.candidatesUtc.some((c, i) => c !== coreRes.candidatesUtc[i])
        ) {
          discrepancies.push({
            id: sample.id,
            local: sample.localMinute,
            oracle: oracleRes,
            core: coreRes,
          });
        }

        // 精确断言
        expect(coreRes.requestedLocal).toBe(oracleRes.requestedLocal);
        expect(coreRes.status).toBe(oracleRes.status);
        expect(coreRes.gapBoundaryUtc).toBe(oracleRes.gapBoundaryUtc);
        expect(coreRes.candidatesUtc).toEqual(oracleRes.candidatesUtc);
      }

      expect(discrepancies).toEqual([]);
    });

    // 针对跳变边界 ±1 分钟的关键子群单独建立断言以确保审查清晰可见
    it('子群验证：纽约春季跳变边界 ±1 分钟 (SMP-01, SMP-02, SMP-06, SMP-07)', () => {
      // 01:59 -> 1 候选 (06:59Z)
      const smp1 = sutMapLocal('2026-03-08 01:59', NEW_YORK_SEGMENTS);
      expect(smp1.status).toBe('NORMAL');
      expect(smp1.candidatesUtc).toEqual(['2026-03-08T06:59:00Z']);

      // 02:00 -> 0 候选 (GAP, 边界 07:00Z)
      const smp2 = sutMapLocal('2026-03-08 02:00', NEW_YORK_SEGMENTS);
      expect(smp2.status).toBe('GAP');
      expect(smp2.candidatesUtc).toEqual([]);
      expect(smp2.gapBoundaryUtc).toBe('2026-03-08T07:00:00Z');

      // 03:00 -> 1 候选 (07:00Z)
      const smp6 = sutMapLocal('2026-03-08 03:00', NEW_YORK_SEGMENTS);
      expect(smp6.status).toBe('NORMAL');
      expect(smp6.candidatesUtc).toEqual(['2026-03-08T07:00:00Z']);

      // 03:01 -> 1 候选 (07:01Z)
      const smp7 = sutMapLocal('2026-03-08 03:01', NEW_YORK_SEGMENTS);
      expect(smp7.status).toBe('NORMAL');
      expect(smp7.candidatesUtc).toEqual(['2026-03-08T07:01:00Z']);
    });

    it('子群验证：纽约秋季回拨边界 ±1 分钟 (SMP-08, SMP-09, SMP-13, SMP-14)', () => {
      // 00:59 -> 1 候选 (04:59Z)
      const smp8 = sutMapLocal('2026-11-01 00:59', NEW_YORK_SEGMENTS);
      expect(smp8.status).toBe('NORMAL');
      expect(smp8.candidatesUtc).toEqual(['2026-11-01T04:59:00Z']);

      // 01:00 -> 2 候选 (05:00Z, 06:00Z)
      const smp9 = sutMapLocal('2026-11-01 01:00', NEW_YORK_SEGMENTS);
      expect(smp9.status).toBe('FOLD');
      expect(smp9.candidatesUtc).toEqual([
        '2026-11-01T05:00:00Z',
        '2026-11-01T06:00:00Z',
      ]);

      // 02:00 -> 1 候选 (07:00Z)
      const smp13 = sutMapLocal('2026-11-01 02:00', NEW_YORK_SEGMENTS);
      expect(smp13.status).toBe('NORMAL');
      expect(smp13.candidatesUtc).toEqual(['2026-11-01T07:00:00Z']);

      // 02:01 -> 1 候选 (07:01Z)
      const smp14 = sutMapLocal('2026-11-01 02:01', NEW_YORK_SEGMENTS);
      expect(smp14.status).toBe('NORMAL');
      expect(smp14.candidatesUtc).toEqual(['2026-11-01T07:01:00Z']);
    });

    it('子群验证：伦敦春季跳变边界 ±1 分钟 (SMP-15, SMP-16, SMP-20, SMP-21)', () => {
      const smp15 = sutMapLocal('2026-03-29 00:59', LONDON_SEGMENTS);
      expect(smp15.status).toBe('NORMAL');
      expect(smp15.candidatesUtc).toEqual(['2026-03-29T00:59:00Z']);

      const smp16 = sutMapLocal('2026-03-29 01:00', LONDON_SEGMENTS);
      expect(smp16.status).toBe('GAP');
      expect(smp16.gapBoundaryUtc).toBe('2026-03-29T01:00:00Z');

      const smp20 = sutMapLocal('2026-03-29 02:00', LONDON_SEGMENTS);
      expect(smp20.status).toBe('NORMAL');
      expect(smp20.candidatesUtc).toEqual(['2026-03-29T01:00:00Z']);

      const smp21 = sutMapLocal('2026-03-29 02:01', LONDON_SEGMENTS);
      expect(smp21.status).toBe('NORMAL');
      expect(smp21.candidatesUtc).toEqual(['2026-03-29T01:01:00Z']);
    });

    it('子群验证：伦敦秋季回拨边界 ±1 分钟 (SMP-22, SMP-23, SMP-27, SMP-28)', () => {
      const smp22 = sutMapLocal('2026-10-25 00:59', LONDON_SEGMENTS);
      expect(smp22.status).toBe('NORMAL');
      expect(smp22.candidatesUtc).toEqual(['2026-10-24T23:59:00Z']);

      const smp23 = sutMapLocal('2026-10-25 01:00', LONDON_SEGMENTS);
      expect(smp23.status).toBe('FOLD');
      expect(smp23.candidatesUtc).toEqual([
        '2026-10-25T00:00:00Z',
        '2026-10-25T01:00:00Z',
      ]);

      const smp27 = sutMapLocal('2026-10-25 02:00', LONDON_SEGMENTS);
      expect(smp27.status).toBe('NORMAL');
      expect(smp27.candidatesUtc).toEqual(['2026-10-25T02:00:00Z']);

      const smp28 = sutMapLocal('2026-10-25 02:01', LONDON_SEGMENTS);
      expect(smp28.status).toBe('NORMAL');
      expect(smp28.candidatesUtc).toEqual(['2026-10-25T02:01:00Z']);
    });

    it('子群验证：跨月与平年 2 月底验证 (SMP-30..31, SMP-36..37, SMP-42..43, SMP-47..48)', () => {
      // 2026 年非闰年，2 月仅 28 天
      // 纽约 2026-02-28 23:59 EST (-300) -> 2026-03-01T04:59:00Z
      const nyFebLast = sutMapLocal('2026-02-28 23:59', NEW_YORK_SEGMENTS);
      expect(nyFebLast.candidatesUtc).toEqual(['2026-03-01T04:59:00Z']);

      // 伦敦 2026-02-28 23:59 GMT (0) -> 2026-02-28T23:59:00Z
      const ldFebLast = sutMapLocal('2026-02-28 23:59', LONDON_SEGMENTS);
      expect(ldFebLast.candidatesUtc).toEqual(['2026-02-28T23:59:00Z']);

      // 东京 2026-02-28 23:59 JST (+540) -> 2026-02-28T14:59:00Z
      const tyFebLast = sutMapLocal('2026-02-28 23:59', TOKYO_SEGMENTS);
      expect(tyFebLast.candidatesUtc).toEqual(['2026-02-28T14:59:00Z']);

      // UTC 2026-02-28 23:59 UTC (0) -> 2026-02-28T23:59:00Z
      const utcFebLast = sutMapLocal('2026-02-28 23:59', UTC_SEGMENTS);
      expect(utcFebLast.candidatesUtc).toEqual(['2026-02-28T23:59:00Z']);
    });
  });
});
