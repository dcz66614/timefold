/**
 * P009 时隙镜 TimeFold — 冻结 2026 时区分段表（教学与基准样本）
 * 严格遵从 PROJECT_BOOK.md §5.4 与 TASK-P009-T004。
 * 统一起点 2025-12-30T00:00:00Z，统一终点 2027-01-03T00:00:00Z，全部区间左闭右开 [startUtc, endUtc)。
 */

import {
  type TimeFoldZone,
  type ZoneSegment,
  ZONE_SNAPSHOT_FROZEN_2026,
} from './types';

/** 2026 冻结时区范围统一起点（左闭） */
export const ZONE_START_UTC = '2025-12-30T00:00:00Z' as const;

/** 2026 冻结时区范围统一终点（右开） */
export const ZONE_END_UTC = '2027-01-03T00:00:00Z' as const;

/** 官方支持的 4 个冻结时区 Label */
export const ZONE_LABEL_NEW_YORK = 'America/New_York' as const;
export const ZONE_LABEL_LONDON = 'Europe/London' as const;
export const ZONE_LABEL_TOKYO = 'Asia/Tokyo' as const;
export const ZONE_LABEL_UTC = 'UTC' as const;

/**
 * America/New_York:
 * 起点 → 2026-03-08T07:00:00Z = -300 (EST)
 * 2026-03-08T07:00:00Z → 2026-11-01T06:00:00Z = -240 (EDT)
 * 2026-11-01T06:00:00Z → 终点 = -300 (EST)
 */
export const NEW_YORK_SEGMENTS: readonly ZoneSegment[] = [
  {
    startUtc: ZONE_START_UTC,
    endUtc: '2026-03-08T07:00:00Z',
    offsetMinutes: -300,
  },
  {
    startUtc: '2026-03-08T07:00:00Z',
    endUtc: '2026-11-01T06:00:00Z',
    offsetMinutes: -240,
  },
  {
    startUtc: '2026-11-01T06:00:00Z',
    endUtc: ZONE_END_UTC,
    offsetMinutes: -300,
  },
];

/**
 * Europe/London:
 * 起点 → 2026-03-29T01:00:00Z = 0 (GMT)
 * 2026-03-29T01:00:00Z → 2026-10-25T01:00:00Z = +60 (BST)
 * 2026-10-25T01:00:00Z → 终点 = 0 (GMT)
 */
export const LONDON_SEGMENTS: readonly ZoneSegment[] = [
  {
    startUtc: ZONE_START_UTC,
    endUtc: '2026-03-29T01:00:00Z',
    offsetMinutes: 0,
  },
  {
    startUtc: '2026-03-29T01:00:00Z',
    endUtc: '2026-10-25T01:00:00Z',
    offsetMinutes: 60,
  },
  {
    startUtc: '2026-10-25T01:00:00Z',
    endUtc: ZONE_END_UTC,
    offsetMinutes: 0,
  },
];

/**
 * Asia/Tokyo:
 * 全程 +540 (JST, UTC+9 无夏令时)
 */
export const TOKYO_SEGMENTS: readonly ZoneSegment[] = [
  {
    startUtc: ZONE_START_UTC,
    endUtc: ZONE_END_UTC,
    offsetMinutes: 540,
  },
];

/**
 * UTC:
 * 全程 0
 */
export const UTC_SEGMENTS: readonly ZoneSegment[] = [
  {
    startUtc: ZONE_START_UTC,
    endUtc: ZONE_END_UTC,
    offsetMinutes: 0,
  },
];

export const ZONE_NEW_YORK: TimeFoldZone = {
  label: ZONE_LABEL_NEW_YORK,
  snapshot: ZONE_SNAPSHOT_FROZEN_2026,
  segments: NEW_YORK_SEGMENTS.map((s) => ({ ...s })),
};

export const ZONE_LONDON: TimeFoldZone = {
  label: ZONE_LABEL_LONDON,
  snapshot: ZONE_SNAPSHOT_FROZEN_2026,
  segments: LONDON_SEGMENTS.map((s) => ({ ...s })),
};

export const ZONE_TOKYO: TimeFoldZone = {
  label: ZONE_LABEL_TOKYO,
  snapshot: ZONE_SNAPSHOT_FROZEN_2026,
  segments: TOKYO_SEGMENTS.map((s) => ({ ...s })),
};

export const ZONE_UTC: TimeFoldZone = {
  label: ZONE_LABEL_UTC,
  snapshot: ZONE_SNAPSHOT_FROZEN_2026,
  segments: UTC_SEGMENTS.map((s) => ({ ...s })),
};

export const FROZEN_ZONES: readonly TimeFoldZone[] = [
  ZONE_NEW_YORK,
  ZONE_LONDON,
  ZONE_TOKYO,
  ZONE_UTC,
];

export const FROZEN_ZONES_BY_LABEL: Readonly<Record<string, TimeFoldZone>> = {
  [ZONE_LABEL_NEW_YORK]: ZONE_NEW_YORK,
  [ZONE_LABEL_LONDON]: ZONE_LONDON,
  [ZONE_LABEL_TOKYO]: ZONE_TOKYO,
  [ZONE_LABEL_UTC]: ZONE_UTC,
};

/**
 * 获取指定 label 的冻结时区快照深拷贝，防止外部直接修改原数据。
 */
export function getFrozenZone(label: string): TimeFoldZone | undefined {
  const zone = FROZEN_ZONES_BY_LABEL[label];
  if (!zone) {
    return undefined;
  }
  return {
    label: zone.label,
    snapshot: zone.snapshot,
    segments: zone.segments.map((s) => ({ ...s })),
  };
}
