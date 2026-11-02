/**
 * P009 时隙镜 TimeFold — 六个确定性预设样本输入
 *
 * 严格遵从 PROJECT_BOOK.md §7 与 IMPLEMENTATION_PLAN.md §5 T009、TASK-P009-T009。
 *
 * 预设包含：
 * - TF-A: 纽约春季缺口 (Spring Gap)
 * - TF-B: 纽约双生一刻 (Fall Fold)
 * - TF-C: 伦敦春季缺口 (London Spring Gap)
 * - TF-D: 伦敦秋季重叠 (London Fall Fold)
 * - TF-E: 东京每日对照常态 (Tokyo Daily)
 * - TF-F: 纽约每周一固定间隔漂移 (Fixed Interval Drift)
 *
 * 所有预设均为人工合成教学样本，标记 synthetic: true。
 * 选择预设必须完全覆盖当前编辑状态，无模糊继承参数。
 */

import {
  type TimeFoldInput,
  TIMEFOLD_SPEC_SCHEMA,
  ZONE_SNAPSHOT_FROZEN_2026,
} from '../core/types';
import {
  NEW_YORK_SEGMENTS,
  LONDON_SEGMENTS,
  TOKYO_SEGMENTS,
  ZONE_LABEL_NEW_YORK,
  ZONE_LABEL_LONDON,
  ZONE_LABEL_TOKYO,
} from '../core/zones';

export type PresetId = 'TF-A' | 'TF-B' | 'TF-C' | 'TF-D' | 'TF-E' | 'TF-F';

export interface PresetInfo {
  id: PresetId;
  label: string;
  name: string;
  description: string;
  input: Readonly<TimeFoldInput>;
}

/** TF-A 纽约春季缺口 */
export const PRESET_TF_A: Readonly<TimeFoldInput> = Object.freeze({
  schema: TIMEFOLD_SPEC_SCHEMA,
  name: 'TF-A Spring Gap',
  synthetic: true,
  zone: Object.freeze({
    label: ZONE_LABEL_NEW_YORK,
    snapshot: ZONE_SNAPSHOT_FROZEN_2026,
    segments: NEW_YORK_SEGMENTS.map((s) => ({ ...s })),
  }),
  schedule: Object.freeze({
    frequency: 'once',
    startDate: '2026-03-08',
    endDate: '2026-03-08',
    localTime: '02:30',
    byWeekday: [],
  }),
  policy: Object.freeze({
    gap: 'skip',
    fold: 'earlier',
  }),
});

/** TF-B 纽约双生一刻 */
export const PRESET_TF_B: Readonly<TimeFoldInput> = Object.freeze({
  schema: TIMEFOLD_SPEC_SCHEMA,
  name: 'TF-B New York Fall Fold',
  synthetic: true,
  zone: Object.freeze({
    label: ZONE_LABEL_NEW_YORK,
    snapshot: ZONE_SNAPSHOT_FROZEN_2026,
    segments: NEW_YORK_SEGMENTS.map((s) => ({ ...s })),
  }),
  schedule: Object.freeze({
    frequency: 'once',
    startDate: '2026-11-01',
    endDate: '2026-11-01',
    localTime: '01:30',
    byWeekday: [],
  }),
  policy: Object.freeze({
    gap: 'skip',
    fold: 'both',
  }),
});

/** TF-C 伦敦春季缺口 */
export const PRESET_TF_C: Readonly<TimeFoldInput> = Object.freeze({
  schema: TIMEFOLD_SPEC_SCHEMA,
  name: 'TF-C London Spring Gap',
  synthetic: true,
  zone: Object.freeze({
    label: ZONE_LABEL_LONDON,
    snapshot: ZONE_SNAPSHOT_FROZEN_2026,
    segments: LONDON_SEGMENTS.map((s) => ({ ...s })),
  }),
  schedule: Object.freeze({
    frequency: 'once',
    startDate: '2026-03-29',
    endDate: '2026-03-29',
    localTime: '01:30',
    byWeekday: [],
  }),
  policy: Object.freeze({
    gap: 'skip',
    fold: 'earlier',
  }),
});

/** TF-D 伦敦秋季重叠 */
export const PRESET_TF_D: Readonly<TimeFoldInput> = Object.freeze({
  schema: TIMEFOLD_SPEC_SCHEMA,
  name: 'TF-D London Fall Fold',
  synthetic: true,
  zone: Object.freeze({
    label: ZONE_LABEL_LONDON,
    snapshot: ZONE_SNAPSHOT_FROZEN_2026,
    segments: LONDON_SEGMENTS.map((s) => ({ ...s })),
  }),
  schedule: Object.freeze({
    frequency: 'once',
    startDate: '2026-10-25',
    endDate: '2026-10-25',
    localTime: '01:30',
    byWeekday: [],
  }),
  policy: Object.freeze({
    gap: 'skip',
    fold: 'both',
  }),
});

/** TF-E 东京每日常态 */
export const PRESET_TF_E: Readonly<TimeFoldInput> = Object.freeze({
  schema: TIMEFOLD_SPEC_SCHEMA,
  name: 'TF-E Tokyo Daily',
  synthetic: true,
  zone: Object.freeze({
    label: ZONE_LABEL_TOKYO,
    snapshot: ZONE_SNAPSHOT_FROZEN_2026,
    segments: TOKYO_SEGMENTS.map((s) => ({ ...s })),
  }),
  schedule: Object.freeze({
    frequency: 'daily',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    localTime: '09:00',
    byWeekday: [],
  }),
  policy: Object.freeze({
    gap: 'skip',
    fold: 'earlier',
  }),
});

/** TF-F 纽约周一固定间隔漂移 */
export const PRESET_TF_F: Readonly<TimeFoldInput> = Object.freeze({
  schema: TIMEFOLD_SPEC_SCHEMA,
  name: 'TF-F Fixed Interval Drift',
  synthetic: true,
  zone: Object.freeze({
    label: ZONE_LABEL_NEW_YORK,
    snapshot: ZONE_SNAPSHOT_FROZEN_2026,
    segments: NEW_YORK_SEGMENTS.map((s) => ({ ...s })),
  }),
  schedule: Object.freeze({
    frequency: 'weekly',
    startDate: '2026-03-02',
    endDate: '2026-03-23',
    localTime: '09:00',
    byWeekday: [1],
  }),
  policy: Object.freeze({
    gap: 'skip',
    fold: 'earlier',
  }),
});

/** 六预设元信息列表 */
export const PRESETS: readonly PresetInfo[] = Object.freeze([
  {
    id: 'TF-A',
    label: 'TF-A 春季缺口',
    name: 'TF-A Spring Gap',
    description: 'New York，once，2026-03-08 02:30，skip/earlier → GAP 候选 0',
    input: PRESET_TF_A,
  },
  {
    id: 'TF-B',
    label: 'TF-B 双生一刻',
    name: 'TF-B New York Fall Fold',
    description: 'New York，once，2026-11-01 01:30，skip/both → FOLD 候选 2',
    input: PRESET_TF_B,
  },
  {
    id: 'TF-C',
    label: 'TF-C 伦敦缺口',
    name: 'TF-C London Spring Gap',
    description: 'London，once，2026-03-29 01:30，skip/earlier → GAP 候选 0',
    input: PRESET_TF_C,
  },
  {
    id: 'TF-D',
    label: 'TF-D 伦敦重叠',
    name: 'TF-D London Fall Fold',
    description: 'London，once，2026-10-25 01:30，skip/both → FOLD 候选 2',
    input: PRESET_TF_D,
  },
  {
    id: 'TF-E',
    label: 'TF-E 东京常态',
    name: 'TF-E Tokyo Daily',
    description: 'Tokyo，daily，2026-06-01..03 09:00，skip/earlier → NORMAL×3',
    input: PRESET_TF_E,
  },
  {
    id: 'TF-F',
    label: 'TF-F 固定间隔漂移',
    name: 'TF-F Fixed Interval Drift',
    description: 'New York，weekly 周一，2026-03-02..23 09:00，skip/earlier → 14/13/13/13 UTC，首见证 +60',
    input: PRESET_TF_F,
  },
]);

/** 预设字典映射 */
export const PRESET_MAP: Readonly<Record<PresetId, PresetInfo>> = Object.freeze({
  'TF-A': PRESETS[0]!,
  'TF-B': PRESETS[1]!,
  'TF-C': PRESETS[2]!,
  'TF-D': PRESETS[3]!,
  'TF-E': PRESETS[4]!,
  'TF-F': PRESETS[5]!,
});

/**
 * 根据预设 ID 获取预设信息
 */
export function getPreset(id: string): PresetInfo | undefined {
  if (id in PRESET_MAP) {
    return PRESET_MAP[id as PresetId];
  }
  return undefined;
}

/**
 * 获取所有预设列表
 */
export function getAllPresets(): readonly PresetInfo[] {
  return PRESETS;
}

/**
 * 获取深度克隆的预设输入对象。
 * 严格确保选择预设时完全覆盖当前编辑状态，不残留旧引用或前一次参数。
 */
export function clonePresetInput(id: PresetId): TimeFoldInput {
  const preset = PRESET_MAP[id];
  if (!preset) {
    throw new Error(`Unknown preset id: ${id}`);
  }
  return JSON.parse(JSON.stringify(preset.input)) as TimeFoldInput;
}
