/**
 * P009-T008 数学不变量与再现性测试 (MATH10)
 *
 * 严格遵循 PROJECT_BOOK.md §8 (MATH10) 与 IMPLEMENTATION_PLAN.md §5 T008。
 *
 * 五大不变量必须全部通过：
 * 1. 6 个预设重算深度一致 (Deterministic Reproducibility Across Multiple Runs)
 * 2. 导出→导入→重算输出一致 (JSON Roundtrip Invariant)
 * 3. 候选反投到请求本地分钟（shiftForward 除外）(Candidate Reverse Projection Invariant)
 * 4. 输入冻结对象无变异 (Immutability with Deep Frozen Inputs)
 * 5. runId 旧结果不污染新结果中可测部分 (Worker Protocol & RunId Concurrency Non-Pollution)
 */

import { describe, expect, it } from 'vitest';
import type { TimeFoldInput, ZoneSegment, AnalysisComputation } from '../../src/core/types';
import {
  analyze,
  validateInput,
  projectUtc,
  NEW_YORK_SEGMENTS,
  LONDON_SEGMENTS,
  TOKYO_SEGMENTS,
  UTC_SEGMENTS,
} from '../../src/core';
import {
  isWorkerRequest,
  isWorkerResponse,
  type WorkerResponse,
} from '../../src/worker/protocol';

/** 深度递归冻结对象，确保任何写操作均会抛出运行时错误 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && (typeof val === 'object' || typeof val === 'function')) {
      deepFreeze(val);
    }
  }
  return obj;
}

/** 深度克隆纯数据对象 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/** 独立解析 ISO UTC 字符串为自 1970-01-01 以来的整数分钟 */
function parseIsoUtc(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(iso);
  if (!match) throw new Error(`Invalid ISO: ${iso}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const hh = Number(match[4]);
  const mm = Number(match[5]);
  const ms = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  return Math.floor(ms / 60000);
}

/** 独立格式化公历民用分钟为 YYYY-MM-DD HH:mm */
function formatCivilLocal(epochMin: number): string {
  const d = new Date(epochMin * 60000);
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

const PRESET_TF_A: TimeFoldInput = {
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

const PRESET_TF_B: TimeFoldInput = {
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

const PRESET_TF_C: TimeFoldInput = {
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

const PRESET_TF_D: TimeFoldInput = {
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

const PRESET_TF_E: TimeFoldInput = {
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

const PRESET_TF_F: TimeFoldInput = {
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

const ALL_PRESETS = [
  { id: 'TF-A', input: PRESET_TF_A },
  { id: 'TF-B', input: PRESET_TF_B },
  { id: 'TF-C', input: PRESET_TF_C },
  { id: 'TF-D', input: PRESET_TF_D },
  { id: 'TF-E', input: PRESET_TF_E },
  { id: 'TF-F', input: PRESET_TF_F },
] as const;

const FROZEN_BOUNDARY_SAMPLE_INPUTS = [
  // 1. New York Spring Gap
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-03-08 01:59' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-03-08 02:00' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-03-08 02:01' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-03-08 02:30' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-03-08 02:59' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-03-08 03:00' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-03-08 03:01' },
  // 2. New York Fall Fold
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-11-01 00:59' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-11-01 01:00' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-11-01 01:01' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-11-01 01:30' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-11-01 01:59' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-11-01 02:00' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-11-01 02:01' },
  // 3. London Spring Gap
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-03-29 00:59' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-03-29 01:00' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-03-29 01:01' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-03-29 01:30' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-03-29 01:59' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-03-29 02:00' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-03-29 02:01' },
  // 4. London Fall Fold
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-10-25 00:59' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-10-25 01:00' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-10-25 01:01' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-10-25 01:30' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-10-25 01:59' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-10-25 02:00' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-10-25 02:01' },
  // 5. New York Normal & Cross-Month
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-01-15 12:00' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-02-28 23:59' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-03-01 00:00' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-06-15 12:00' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-10-31 23:59' },
  { zone: 'America/New_York', segs: NEW_YORK_SEGMENTS, local: '2026-12-31 23:59' },
  // 6. London Normal & Cross-Month
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-01-15 12:00' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-02-28 23:59' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-03-01 00:00' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-07-15 12:00' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-08-31 23:59' },
  { zone: 'Europe/London', segs: LONDON_SEGMENTS, local: '2026-09-01 00:00' },
  // 7. Tokyo Normal & Cross-Month
  { zone: 'Asia/Tokyo', segs: TOKYO_SEGMENTS, local: '2026-01-01 09:00' },
  { zone: 'Asia/Tokyo', segs: TOKYO_SEGMENTS, local: '2026-02-28 23:59' },
  { zone: 'Asia/Tokyo', segs: TOKYO_SEGMENTS, local: '2026-03-01 00:00' },
  { zone: 'Asia/Tokyo', segs: TOKYO_SEGMENTS, local: '2026-06-01 09:00' },
  { zone: 'Asia/Tokyo', segs: TOKYO_SEGMENTS, local: '2026-12-31 23:59' },
  // 8. UTC Normal & Cross-Month
  { zone: 'UTC', segs: UTC_SEGMENTS, local: '2026-01-01 00:00' },
  { zone: 'UTC', segs: UTC_SEGMENTS, local: '2026-02-28 23:59' },
  { zone: 'UTC', segs: UTC_SEGMENTS, local: '2026-03-01 00:00' },
  { zone: 'UTC', segs: UTC_SEGMENTS, local: '2026-06-15 12:00' },
  { zone: 'UTC', segs: UTC_SEGMENTS, local: '2026-12-31 23:59' },
];

describe('TASK-P009-T008 不变量与再现性测试 (MATH10)', () => {
  /* ========================================================================
   * 不变量 1：6 个预设重算深度一致
   * ======================================================================== */
  describe('1. 6 个预设重算深度一致 (Deterministic Reproducibility)', () => {
    it('对全部 6 个预设连续重复执行 5 次，每次返回结果逐字段、逐项深度等价', () => {
      for (const preset of ALL_PRESETS) {
        const firstResult = analyze(preset.input);

        for (let iteration = 1; iteration <= 4; iteration++) {
          const subsequentResult = analyze(preset.input);

          // 核心结构深度完全相等
          expect(subsequentResult).toEqual(firstResult);

          // 确认并非直接返回原对象引用，每次是纯计算生成的新结果
          expect(subsequentResult).not.toBe(firstResult);
          expect(subsequentResult.occurrences).not.toBe(firstResult.occurrences);
        }
      }
    });
  });

  /* ========================================================================
   * 不变量 2：导出→导入→重算输出一致 (JSON Roundtrip)
   * ======================================================================== */
  describe('2. 导出→导入→重算输出一致 (JSON Roundtrip Invariant)', () => {
    it('6 个预设经 JSON 序列化与反序列化后重算，结果与原始重算深度完全一致', () => {
      for (const preset of ALL_PRESETS) {
        const baselineResult = analyze(preset.input);

        // 模拟文件导出 (JSON.stringify)
        const jsonExport = JSON.stringify(preset.input, null, 2);

        // 模拟文件导入 (JSON.parse)
        const importedInput = JSON.parse(jsonExport) as TimeFoldInput;

        // 重新调用 analyze 算核
        const recomputedResult = analyze(importedInput);

        // 断言重算结果深度一致
        expect(recomputedResult).toEqual(baselineResult);
      }
    });

    it('自定义策略变体经 JSON 序列化与反序列化后，重算输出依然完全一致', () => {
      const variants: TimeFoldInput[] = [
        {
          ...PRESET_TF_A,
          policy: { gap: 'shiftForward', fold: 'earlier' },
        },
        {
          ...PRESET_TF_B,
          policy: { gap: 'skip', fold: 'earlier' },
        },
        {
          ...PRESET_TF_B,
          policy: { gap: 'skip', fold: 'later' },
        },
        {
          ...PRESET_TF_C,
          policy: { gap: 'shiftForward', fold: 'later' },
        },
        {
          ...PRESET_TF_F,
          schedule: {
            ...PRESET_TF_F.schedule,
            startDate: '2026-03-02',
            endDate: '2026-03-30',
          },
        },
      ];

      for (const variant of variants) {
        const base = analyze(variant);
        const roundtrip = JSON.parse(JSON.stringify(variant)) as TimeFoldInput;
        const recomputed = analyze(roundtrip);
        expect(recomputed).toEqual(base);
      }
    });
  });

  /* ========================================================================
   * 不变量 3：候选必须反投到请求本地分钟（shiftForward 除外）
   * ======================================================================== */
  describe('3. 候选反投本地分钟不变量 (Candidate Reverse Projection Invariant)', () => {
    /** 纯分段表反投 helper：将 UTC 分钟通过分段表 offset 投回本地分钟 */
    function projectCandidateToLocal(
      utcIso: string,
      segments: readonly ZoneSegment[]
    ): string {
      const utcMin = parseIsoUtc(utcIso);
      for (const seg of segments) {
        const start = parseIsoUtc(seg.startUtc);
        const end = parseIsoUtc(seg.endUtc);
        if (utcMin >= start && utcMin < end) {
          const localMin = utcMin + seg.offsetMinutes;
          return formatCivilLocal(localMin);
        }
      }
      throw new Error(`Candidate ${utcIso} outside zone segments`);
    }

    it('全部 6 个预设 occurrences 中的每一个 candidatesUtc 实例反投均等于 requestedLocal', () => {
      for (const preset of ALL_PRESETS) {
        const result = analyze(preset.input);
        for (const occ of result.occurrences) {
          for (const candUtc of occ.candidatesUtc) {
            // 使用 projectUtc (内核导出) 反投
            const coreProjected = projectUtc(candUtc, preset.input.zone.segments);
            expect(coreProjected).toBe(occ.requestedLocal);

            // 使用纯分段表 independent helper 反投交叉确认
            const oracleProjected = projectCandidateToLocal(candUtc, preset.input.zone.segments);
            expect(oracleProjected).toBe(occ.requestedLocal);
          }
        }
      }
    });

    it('50 个冻结样本中，所有产生候选的样本反投本地时间严格等于原始样本请求时间', () => {
      expect(FROZEN_BOUNDARY_SAMPLE_INPUTS.length).toBe(50);
      for (let i = 0; i < FROZEN_BOUNDARY_SAMPLE_INPUTS.length; i++) {
        const sample = FROZEN_BOUNDARY_SAMPLE_INPUTS[i]!;
        const res = analyze({
          schema: 'timefold.spec/1',
          name: `Sample-${i + 1}`,
          synthetic: true,
          zone: {
            label: sample.zone,
            snapshot: 'frozen-2026',
            segments: [...sample.segs],
          },
          schedule: {
            frequency: 'once',
            startDate: sample.local.slice(0, 10),
            endDate: sample.local.slice(0, 10),
            localTime: sample.local.slice(11, 16),
            byWeekday: [],
          },
          policy: { gap: 'skip', fold: 'both' },
        });

        const occ = res.occurrences[0]!;
        for (const candUtc of occ.candidatesUtc) {
          const projected = projectCandidateToLocal(candUtc, sample.segs);
          expect(projected).toBe(sample.local);
        }
      }
    });

    it('在 shiftForward 模式下，selectedUtc 反投到 realizedLocal，且恰好等于跳变恢复时刻', () => {
      // TF-A shiftForward: 02:30 缺口被顺延到 03:00 (07:00Z)
      const tfAShift: TimeFoldInput = {
        ...PRESET_TF_A,
        policy: { gap: 'shiftForward', fold: 'earlier' },
      };
      const resA = analyze(tfAShift);
      const occA = resA.occurrences[0]!;
      expect(occA.status).toBe('GAP');
      expect(occA.candidatesUtc).toEqual([]); // 候选集依然是空集
      expect(occA.selectedUtc).toEqual(['2026-03-08T07:00:00Z']);
      expect(occA.realizedLocal).toEqual(['2026-03-08 03:00']);

      const projA = projectCandidateToLocal(occA.selectedUtc[0]!, PRESET_TF_A.zone.segments);
      expect(projA).toBe(occA.realizedLocal[0]);
      expect(projA).toBe('2026-03-08 03:00');

      // TF-C shiftForward: 伦敦 01:30 缺口被顺延到 02:00 (01:00Z)
      const tfCShift: TimeFoldInput = {
        ...PRESET_TF_C,
        policy: { gap: 'shiftForward', fold: 'earlier' },
      };
      const resC = analyze(tfCShift);
      const occC = resC.occurrences[0]!;
      expect(occC.status).toBe('GAP');
      expect(occC.selectedUtc).toEqual(['2026-03-29T01:00:00Z']);
      expect(occC.realizedLocal).toEqual(['2026-03-29 02:00']);

      const projC = projectCandidateToLocal(occC.selectedUtc[0]!, PRESET_TF_C.zone.segments);
      expect(projC).toBe(occC.realizedLocal[0]);
      expect(projC).toBe('2026-03-29 02:00');
    });
  });

  /* ========================================================================
   * 不变量 4：输入冻结对象无变异 (Deep Object Freeze Immutability)
   * ======================================================================== */
  describe('4. 输入冻结对象无变异 (Deep Object Freeze Immutability)', () => {
    it('当输入对象及其所有嵌套属性被深度 Object.freeze 时，analyze 纯函数安全计算且绝不引发变异报错', () => {
      for (const preset of ALL_PRESETS) {
        // 创建独立副本并深度冻结
        const frozenInput = deepFreeze(deepClone(preset.input));

        // 验证冻结确实生效：尝试向其添加或修改属性必须抛出 TypeError
        expect(() => {
          (frozenInput as Record<string, unknown>)['mutatedField'] = true;
        }).toThrow(TypeError);
        expect(() => {
          (frozenInput.zone as Record<string, unknown>)['label'] = 'mutated';
        }).toThrow(TypeError);

        // 验证 analyze 在深冻结输入下平稳运行，绝无写入操作
        expect(() => {
          const res = analyze(frozenInput);
          expect(res.schema).toBe('timefold.result/1');
          expect(res.requestCount).toBeGreaterThan(0);
        }).not.toThrow();

        // 验证 validateInput 单独在冻结输入下同样无变异
        expect(() => {
          validateInput(frozenInput);
        }).not.toThrow();
      }
    });
  });

  /* ========================================================================
   * 不变量 5：runId 旧结果不污染新结果中可测部分
   * ======================================================================== */
  describe('5. runId 旧结果不污染新结果 (Worker Protocol & Concurrency Isolation)', () => {
    it('纯计算层面：高频轮替调用不同预设 100 次，各次计算完全独立无残留状态污染', () => {
      const expectedA = analyze(PRESET_TF_A);
      const expectedB = analyze(PRESET_TF_B);
      const expectedE = analyze(PRESET_TF_E);
      const expectedF = analyze(PRESET_TF_F);

      for (let i = 0; i < 25; i++) {
        expect(analyze(PRESET_TF_A)).toEqual(expectedA);
        expect(analyze(PRESET_TF_B)).toEqual(expectedB);
        expect(analyze(PRESET_TF_E)).toEqual(expectedE);
        expect(analyze(PRESET_TF_F)).toEqual(expectedF);
      }
    });

    it('Worker 协议守卫：正确识别合法的 WorkerRequest 与 WorkerResponse 消息', () => {
      const validAnalyzeReq = {
        kind: 'ANALYZE',
        runId: 101,
        input: PRESET_TF_B,
      };
      expect(isWorkerRequest(validAnalyzeReq)).toBe(true);

      const validCancelReq = {
        kind: 'CANCEL',
        runId: 102,
      };
      expect(isWorkerRequest(validCancelReq)).toBe(true);

      // 非法结构
      expect(isWorkerRequest(null)).toBe(false);
      expect(isWorkerRequest({})).toBe(false);
      expect(isWorkerRequest({ kind: 'UNKNOWN', runId: 1 })).toBe(false);
      expect(isWorkerRequest({ kind: 'ANALYZE' })).toBe(false); // 缺少 runId

      // 响应结构
      const validResultResp = {
        kind: 'RESULT',
        runId: 101,
        result: {
          ...analyze(PRESET_TF_B),
          digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      };
      expect(isWorkerResponse(validResultResp)).toBe(true);

      const validErrorResp = {
        kind: 'ERROR',
        runId: 101,
        code: 'E_INVALID_DATE',
        path: 'schedule.startDate',
        message: 'Invalid date string',
      };
      expect(isWorkerResponse(validErrorResp)).toBe(true);
    });

    it('UI 状态机模拟：延迟到达的过旧 runId 响应被严格丢弃，绝不污染 activeRunId 的最新状态', () => {
      /**
       * 模拟主线程状态调度器（严格遵从 PROJECT_BOOK.md §6.3 规范）：
       * - 前端每次运行时递增 runId 并记录 activeRunId；
       * - 每条 Worker 结果只在 response.runId === activeRunId 时入状态；
       * - 取消操作先让当前 runId 无效 (activeRunId = null)。
       */
      class MockClientStateManager {
        activeRunId: number | null = null;
        committedResult: AnalysisComputation | null = null;
        committedRunId: number | null = null;
        nextRunId = 1;

        dispatch(input: TimeFoldInput): { req: { kind: 'ANALYZE'; runId: number; input: TimeFoldInput }; runId: number } {
          const runId = this.nextRunId++;
          this.activeRunId = runId;
          return { req: { kind: 'ANALYZE', runId, input }, runId };
        }

        cancel(): void {
          this.activeRunId = null;
        }

        onWorkerMessage(resp: WorkerResponse): boolean {
          if (!isWorkerResponse(resp)) {
            return false;
          }
          if (resp.runId !== this.activeRunId) {
            // 拒绝过期或已取消的 runId，实现零污染
            return false;
          }
          if (resp.kind === 'RESULT') {
            this.committedResult = resp.result;
            this.committedRunId = resp.runId;
            return true;
          }
          return false;
        }
      }

      const client = new MockClientStateManager();

      // 1. 用户触发了 TF-A 计算 (runId = 1)
      const dispatch1 = client.dispatch(PRESET_TF_A);
      expect(dispatch1.runId).toBe(1);
      expect(client.activeRunId).toBe(1);

      // 2. 在 runId = 1 计算返回之前，用户迅速切换到了预设 TF-B (runId = 2)
      const dispatch2 = client.dispatch(PRESET_TF_B);
      expect(dispatch2.runId).toBe(2);
      expect(client.activeRunId).toBe(2);

      // 3. 此时 runId = 1 的计算结果迟滞返回
      const lateResp1: WorkerResponse = {
        kind: 'RESULT',
        runId: 1,
        result: {
          ...analyze(PRESET_TF_A),
          digest: 'sha256-dummy-1',
        },
      };
      const accepted1 = client.onWorkerMessage(lateResp1);
      // 必须被拒收！
      expect(accepted1).toBe(false);
      expect(client.committedResult).toBeNull();
      expect(client.committedRunId).toBeNull();

      // 4. runId = 2 的结果正常返回
      const freshResp2: WorkerResponse = {
        kind: 'RESULT',
        runId: 2,
        result: {
          ...analyze(PRESET_TF_B),
          digest: 'sha256-dummy-2',
        },
      };
      const accepted2 = client.onWorkerMessage(freshResp2);
      expect(accepted2).toBe(true);
      expect(client.committedRunId).toBe(2);
      expect(client.committedResult?.input.name).toBe('TF-B New York Fall Fold');

      // 5. 用户触发 CANCEL，activeRunId 被置空
      client.cancel();
      expect(client.activeRunId).toBeNull();

      // 6. 假设之后又有残留的 runId = 2 消息或错误到达，均被拒绝
      const strayResp: WorkerResponse = {
        kind: 'RESULT',
        runId: 2,
        result: {
          ...analyze(PRESET_TF_B),
          digest: 'sha256-dummy-2-again',
        },
      };
      const acceptedStray = client.onWorkerMessage(strayResp);
      expect(acceptedStray).toBe(false);
    });
  });
});
