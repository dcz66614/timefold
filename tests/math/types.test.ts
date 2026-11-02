import { describe, it, expect } from 'vitest';
import {
  TIMEFOLD_SPEC_SCHEMA,
  TIMEFOLD_RESULT_SCHEMA,
  TIMEFOLD_EXPORT_SCHEMA,
  ZONE_SNAPSHOT_FROZEN_2026,
  type ZoneSegment,
  type TimeFoldInput,
  type Mapping,
  type Evidence,
  type AnalysisResult,
  type MappingCandidate,
  type SelectedMapping,
  type TimeFoldExport,
  type TimeFoldErrorDetail,
  TimeFoldError,
} from '../../src/core/types';
import {
  type WorkerRequest,
  type WorkerResponse,
  isWorkerRequest,
  isWorkerResponse,
} from '../../src/worker/protocol';

// 类型级静态断言辅助类型（若不兼容则引发 tsc 编译期类型错误）
type AssertExtends<T, Expected> = [T] extends [Expected] ? true : never;
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// 1. 静态类型级断言
type _SchemaCheck = AssertEqual<TimeFoldInput['schema'], 'timefold.spec/1'>;
type _ResultSchemaCheck = AssertEqual<AnalysisResult['schema'], 'timefold.result/1'>;
type _ExportSchemaCheck = AssertEqual<TimeFoldExport['schema'], 'timefold.export/1'>;
type _SyntheticCheck = AssertEqual<TimeFoldInput['synthetic'], true>;
type _SnapshotCheck = AssertEqual<TimeFoldInput['zone']['snapshot'], 'frozen-2026'>;
type _FrequencyCheck = AssertEqual<
  TimeFoldInput['schedule']['frequency'],
  'once' | 'daily' | 'weekly'
>;
type _GapPolicyCheck = AssertEqual<TimeFoldInput['policy']['gap'], 'skip' | 'shiftForward'>;
type _FoldPolicyCheck = AssertEqual<TimeFoldInput['policy']['fold'], 'earlier' | 'later' | 'both'>;
type _MappingStatusCheck = AssertEqual<Mapping['status'], 'NORMAL' | 'GAP' | 'FOLD'>;
type _EvidenceTypeCheck = AssertEqual<Evidence['type'], 'GAP' | 'FOLD' | 'DRIFT' | 'NONE'>;
type _WorkerRequestKinds = AssertEqual<WorkerRequest['kind'], 'ANALYZE' | 'CANCEL'>;
type _WorkerResponseKinds = AssertEqual<WorkerResponse['kind'], 'RESULT' | 'ERROR'>;

describe('T002 Type Contract Verification', () => {
  it('freezes schema string constants', () => {
    expect(TIMEFOLD_SPEC_SCHEMA).toBe('timefold.spec/1');
    expect(TIMEFOLD_RESULT_SCHEMA).toBe('timefold.result/1');
    expect(TIMEFOLD_EXPORT_SCHEMA).toBe('timefold.export/1');
    expect(ZONE_SNAPSHOT_FROZEN_2026).toBe('frozen-2026');
  });

  it('validates TF-B golden specification matching TimeFoldInput', () => {
    const tfBInput: TimeFoldInput = {
      schema: 'timefold.spec/1',
      name: 'TF-B New York Fall Fold',
      synthetic: true,
      zone: {
        label: 'America/New_York',
        snapshot: 'frozen-2026',
        segments: [
          {
            startUtc: '2025-12-30T00:00:00Z',
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
            endUtc: '2027-01-03T00:00:00Z',
            offsetMinutes: -300,
          },
        ],
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

    expect(tfBInput.schema).toBe('timefold.spec/1');
    expect(tfBInput.synthetic).toBe(true);
    expect(tfBInput.zone.snapshot).toBe('frozen-2026');
    expect(tfBInput.schedule.frequency).toBe('once');
    expect(tfBInput.policy.gap).toBe('skip');
    expect(tfBInput.policy.fold).toBe('both');
  });

  it('validates Mapping and Evidence structure conforming to §6.1', () => {
    const mapping: Mapping = {
      requestedLocal: '2026-11-01 01:30',
      status: 'FOLD',
      candidatesUtc: ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'],
      selectedUtc: ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'],
      realizedLocal: ['2026-11-01 01:30', '2026-11-01 01:30'],
      baselineUtc: null,
      driftMinutes: null,
    };

    const evidence: Evidence = {
      type: 'FOLD',
      date: '2026-11-01',
      boundaryUtc: '2026-11-01T06:00:00Z',
      message: 'Detected fold: 2 UTC candidates for requested time',
      mapping,
    };

    expect(evidence.type).toBe('FOLD');
    expect(evidence.mapping?.status).toBe('FOLD');
    expect(evidence.mapping?.candidatesUtc).toHaveLength(2);
  });

  it('validates AnalysisResult structure', () => {
    const mockInput: TimeFoldInput = {
      schema: 'timefold.spec/1',
      name: 'Tokyo Regular',
      synthetic: true,
      zone: {
        label: 'Asia/Tokyo',
        snapshot: 'frozen-2026',
        segments: [
          {
            startUtc: '2025-12-30T00:00:00Z',
            endUtc: '2027-01-03T00:00:00Z',
            offsetMinutes: 540,
          },
        ],
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

    const result: AnalysisResult = {
      schema: 'timefold.result/1',
      input: mockInput,
      occurrences: [
        {
          requestedLocal: '2026-06-01 09:00',
          status: 'NORMAL',
          candidatesUtc: ['2026-06-01T00:00:00Z'],
          selectedUtc: ['2026-06-01T00:00:00Z'],
          realizedLocal: ['2026-06-01 09:00'],
          baselineUtc: '2026-06-01T00:00:00Z',
          driftMinutes: 0,
        },
      ],
      requestCount: 1,
      selectedCount: 1,
      firstWitness: {
        type: 'NONE',
        date: null,
        boundaryUtc: null,
        message: 'No gap, fold, or drift detected',
        mapping: null,
      },
      digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    };

    expect(result.schema).toBe('timefold.result/1');
    expect(result.firstWitness.type).toBe('NONE');
    expect(result.requestCount).toBe(1);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('validates TimeFoldError and TimeFoldErrorDetail contract', () => {
    const errorDetail: TimeFoldErrorDetail = {
      code: 'E_SEGMENT_GAP',
      path: 'zone.segments[1].startUtc',
      message: 'Segments must be contiguous: gap detected between segments',
    };

    const error = new TimeFoldError(errorDetail);
    expect(error.name).toBe('TimeFoldError');
    expect(error.code).toBe('E_SEGMENT_GAP');
    expect(error.path).toBe('zone.segments[1].startUtc');
    expect(error.message).toContain('contiguous');
    expect(error.toJSON()).toEqual(errorDetail);
  });

  it('validates Worker protocol types and runtime guards', () => {
    const analyzeReq: WorkerRequest = {
      kind: 'ANALYZE',
      runId: 1,
      input: {
        schema: 'timefold.spec/1',
        name: 'test',
        synthetic: true,
        zone: { label: 'UTC', snapshot: 'frozen-2026', segments: [] },
        schedule: {
          frequency: 'once',
          startDate: '2026-01-01',
          endDate: '2026-01-01',
          localTime: '00:00',
          byWeekday: [],
        },
        policy: { gap: 'skip', fold: 'earlier' },
      },
    };
    const cancelReq: WorkerRequest = {
      kind: 'CANCEL',
      runId: 2,
    };
    const errorRes: WorkerResponse = {
      kind: 'ERROR',
      runId: 1,
      code: 'E_SEGMENT_GAP',
      path: 'zone.segments[1].startUtc',
      message: 'Gap detected',
    };

    expect(isWorkerRequest(analyzeReq)).toBe(true);
    expect(isWorkerRequest(cancelReq)).toBe(true);
    expect(isWorkerRequest({ kind: 'UNKNOWN', runId: 1 })).toBe(false);
    expect(isWorkerRequest(null)).toBe(false);

    expect(isWorkerResponse(errorRes)).toBe(true);
    expect(isWorkerResponse({ kind: 'ERROR', runId: 1 })).toBe(false);
    expect(isWorkerResponse(null)).toBe(false);
  });
});
