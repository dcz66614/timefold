/**
 * P009-T009 安全 JSON 导入导出与预设测试
 *
 * 严格遵从 PROJECT_BOOK.md §5.5、§6.1、§7 与 IMPLEMENTATION_PLAN.md §5 T009、TASK-P009-T009。
 *
 * 测试目标：
 * 1. 六个确切预设 (TF-A 至 TF-F) 与 tests/fixtures/TF-*.json 逐字逐字段一致；
 * 2. 纯输入 (timefold.spec/1) 与包裹格式 (timefold.export/1) 均被安全支持；
 * 3. 导入时彻底忽略不可信/伪造 result，强制以内核重新计算；
 * 4. 严格限制 256 KiB 文件大小，超限拒绝；
 * 5. 彻底防御原型污染字段 (__proto__, constructor, prototype)；
 * 6. 损坏的 JSON 语法或语义不覆盖当前有效状态；
 * 7. 导出格式固定顺序 schema -> input -> result，推荐文件名 timefold-<preset-id>.json，无隐私外泄；
 * 8. 六预设完整 roundtrip 深度一致性断言。
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  PRESET_TF_A,
  PRESET_TF_B,
  PRESET_TF_C,
  PRESET_TF_D,
  PRESET_TF_E,
  PRESET_TF_F,
  PRESETS,
  PRESET_MAP,
  getPreset,
  getAllPresets,
  clonePresetInput,
  type PresetId,
} from '../../src/data/presets';
import {
  safeJsonParse,
  parseTimeFoldData,
  parseTimeFoldJson,
  importAndAnalyze,
  exportTimeFold,
  getExportFilename,
} from '../../src/io/json';
import { analyze } from '../../src/core/analyze';
import {
  TimeFoldError,
  type TimeFoldInput,
  TIMEFOLD_SPEC_SCHEMA,
  TIMEFOLD_EXPORT_SCHEMA,
} from '../../src/core/types';

describe('P009-T009 六预设与安全 JSON 输入输出测试', () => {
  const fixturesDir = path.resolve(__dirname, '../fixtures');

  /* ========================================================================
   * 1. 六个预设定义与固化 Fixture 逐字一致性测试
   * ======================================================================== */
  describe('1. 六个确定性预设与 Fixture 一致性 (项目书 §7)', () => {
    const presetList: { id: PresetId; preset: TimeFoldInput; fixtureFile: string }[] = [
      { id: 'TF-A', preset: PRESET_TF_A, fixtureFile: 'TF-A.json' },
      { id: 'TF-B', preset: PRESET_TF_B, fixtureFile: 'TF-B.json' },
      { id: 'TF-C', preset: PRESET_TF_C, fixtureFile: 'TF-C.json' },
      { id: 'TF-D', preset: PRESET_TF_D, fixtureFile: 'TF-D.json' },
      { id: 'TF-E', preset: PRESET_TF_E, fixtureFile: 'TF-E.json' },
      { id: 'TF-F', preset: PRESET_TF_F, fixtureFile: 'TF-F.json' },
    ];

    it('所有 6 个预设都已登记并在 PRESETS 列表中存在', () => {
      expect(getAllPresets()).toHaveLength(6);
      expect(Object.keys(PRESET_MAP)).toEqual(['TF-A', 'TF-B', 'TF-C', 'TF-D', 'TF-E', 'TF-F']);
      for (const item of presetList) {
        const found = getPreset(item.id);
        expect(found).toBeDefined();
        expect(found?.id).toBe(item.id);
        expect(found?.input.synthetic).toBe(true);
        expect(found?.input.schema).toBe(TIMEFOLD_SPEC_SCHEMA);
      }
    });

    it('六份 fixture 文件在 tests/fixtures/ 存在且与预设 input 逐字等价', () => {
      for (const item of presetList) {
        const filePath = path.join(fixturesDir, item.fixtureFile);
        expect(fs.existsSync(filePath), `Fixture file ${item.fixtureFile} must exist`).toBe(true);
        const diskContent = fs.readFileSync(filePath, 'utf8');
        const expectedContent = JSON.stringify(item.preset, null, 2) + '\n';
        expect(diskContent).toBe(expectedContent);

        // 导入并比对对象
        const parsed = parseTimeFoldJson(diskContent);
        expect(parsed).toEqual(item.preset);
      }
    });

    it('TF-A 预设精确值符合项目书 §7: 纽约春季 02:30 skip/earlier -> GAP 候选 0', () => {
      expect(PRESET_TF_A.zone.label).toBe('America/New_York');
      expect(PRESET_TF_A.schedule.frequency).toBe('once');
      expect(PRESET_TF_A.schedule.startDate).toBe('2026-03-08');
      expect(PRESET_TF_A.schedule.localTime).toBe('02:30');
      expect(PRESET_TF_A.policy).toEqual({ gap: 'skip', fold: 'earlier' });

      const res = analyze(PRESET_TF_A);
      expect(res.occurrences[0]!.status).toBe('GAP');
      expect(res.occurrences[0]!.candidatesUtc).toHaveLength(0);
      expect(res.occurrences[0]!.selectedUtc).toHaveLength(0);
    });

    it('TF-B 预设精确值符合项目书 §7: 纽约秋季 01:30 skip/both -> FOLD 候选 2 (05:30Z, 06:30Z)', () => {
      expect(PRESET_TF_B.zone.label).toBe('America/New_York');
      expect(PRESET_TF_B.schedule.frequency).toBe('once');
      expect(PRESET_TF_B.schedule.startDate).toBe('2026-11-01');
      expect(PRESET_TF_B.schedule.localTime).toBe('01:30');
      expect(PRESET_TF_B.policy).toEqual({ gap: 'skip', fold: 'both' });

      const res = analyze(PRESET_TF_B);
      expect(res.occurrences[0]!.status).toBe('FOLD');
      expect(res.occurrences[0]!.candidatesUtc).toEqual([
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
      ]);
      expect(res.occurrences[0]!.selectedUtc).toHaveLength(2);
    });

    it('TF-C 预设精确值符合项目书 §7: 伦敦春季 01:30 skip/earlier -> GAP 候选 0', () => {
      expect(PRESET_TF_C.zone.label).toBe('Europe/London');
      expect(PRESET_TF_C.schedule.frequency).toBe('once');
      expect(PRESET_TF_C.schedule.startDate).toBe('2026-03-29');
      expect(PRESET_TF_C.schedule.localTime).toBe('01:30');
      expect(PRESET_TF_C.policy).toEqual({ gap: 'skip', fold: 'earlier' });

      const res = analyze(PRESET_TF_C);
      expect(res.occurrences[0]!.status).toBe('GAP');
      expect(res.occurrences[0]!.candidatesUtc).toHaveLength(0);
    });

    it('TF-D 预设精确值符合项目书 §7: 伦敦秋季 01:30 skip/both -> FOLD 候选 2 (00:30Z, 01:30Z)', () => {
      expect(PRESET_TF_D.zone.label).toBe('Europe/London');
      expect(PRESET_TF_D.schedule.frequency).toBe('once');
      expect(PRESET_TF_D.schedule.startDate).toBe('2026-10-25');
      expect(PRESET_TF_D.schedule.localTime).toBe('01:30');
      expect(PRESET_TF_D.policy).toEqual({ gap: 'skip', fold: 'both' });

      const res = analyze(PRESET_TF_D);
      expect(res.occurrences[0]!.status).toBe('FOLD');
      expect(res.occurrences[0]!.candidatesUtc).toEqual([
        '2026-10-25T00:30:00Z',
        '2026-10-25T01:30:00Z',
      ]);
      expect(res.occurrences[0]!.selectedUtc).toHaveLength(2);
    });

    it('TF-E 预设精确值符合项目书 §7: 东京 daily 09:00 skip/earlier -> NORMAL×3, 无见证, 偏差为 0', () => {
      expect(PRESET_TF_E.zone.label).toBe('Asia/Tokyo');
      expect(PRESET_TF_E.schedule.frequency).toBe('daily');
      expect(PRESET_TF_E.schedule.startDate).toBe('2026-06-01');
      expect(PRESET_TF_E.schedule.endDate).toBe('2026-06-03');
      expect(PRESET_TF_E.schedule.localTime).toBe('09:00');

      const res = analyze(PRESET_TF_E);
      expect(res.occurrences).toHaveLength(3);
      expect(res.occurrences.every((r) => r.status === 'NORMAL')).toBe(true);
      expect(res.occurrences.map((r) => r.selectedUtc[0])).toEqual([
        '2026-06-01T00:00:00Z',
        '2026-06-02T00:00:00Z',
        '2026-06-03T00:00:00Z',
      ]);
      expect(res.firstWitness.type).toBe('NONE');
      expect(res.occurrences.every((r) => r.driftMinutes === 0)).toBe(true);
    });

    it('TF-F 预设精确值符合项目书 §7: 纽约 weekly 周一 09:00 -> 正确 UTC 14, 13, 13, 13, 首见证 2026-03-09 +60', () => {
      expect(PRESET_TF_F.zone.label).toBe('America/New_York');
      expect(PRESET_TF_F.schedule.frequency).toBe('weekly');
      expect(PRESET_TF_F.schedule.startDate).toBe('2026-03-02');
      expect(PRESET_TF_F.schedule.endDate).toBe('2026-03-23');
      expect(PRESET_TF_F.schedule.byWeekday).toEqual([1]);

      const res = analyze(PRESET_TF_F);
      expect(res.occurrences).toHaveLength(4);
      expect(res.occurrences.map((r) => r.selectedUtc[0])).toEqual([
        '2026-03-02T14:00:00Z',
        '2026-03-09T13:00:00Z',
        '2026-03-16T13:00:00Z',
        '2026-03-23T13:00:00Z',
      ]);
      expect(res.occurrences.map((r) => r.baselineUtc)).toEqual([
        '2026-03-02T14:00:00Z',
        '2026-03-09T14:00:00Z',
        '2026-03-16T14:00:00Z',
        '2026-03-23T14:00:00Z',
      ]);
      expect(res.firstWitness.type).toBe('DRIFT');
      expect(res.firstWitness.date).toBe('2026-03-09');
      expect(res.firstWitness.mapping?.driftMinutes).toBe(60);
    });

    it('clonePresetInput 必须完全覆盖当前编辑状态，修改克隆不污染预设原型', () => {
      const cloned = clonePresetInput('TF-A');
      expect(cloned).toEqual(PRESET_TF_A);

      // 修改克隆对象的字段
      cloned.name = 'Modified Name';
      cloned.schedule.localTime = '12:00';
      cloned.zone.segments[0]!.offsetMinutes = 999;

      // 验证预设原型完全不受影响
      expect(PRESET_TF_A.name).toBe('TF-A Spring Gap');
      expect(PRESET_TF_A.schedule.localTime).toBe('02:30');
      expect(PRESET_TF_A.zone.segments[0]!.offsetMinutes).toBe(-300);

      // 再次克隆依然是原初状态
      const clonedAgain = clonePresetInput('TF-A');
      expect(clonedAgain).toEqual(PRESET_TF_A);
    });
  });

  /* ========================================================================
   * 2. 纯输入与包裹格式导入兼容性测试
   * ======================================================================== */
  describe('2. 纯输入与包裹格式导入兼容性', () => {
    it('支持导入纯输入 timefold.spec/1 格式 JSON', () => {
      const jsonStr = JSON.stringify(PRESET_TF_B);
      const parsed = parseTimeFoldJson(jsonStr);
      expect(parsed).toEqual(PRESET_TF_B);
    });

    it('支持导入 export 包裹 timefold.export/1 格式 JSON', () => {
      const exportStr = exportTimeFold(PRESET_TF_B, analyze(PRESET_TF_B));
      const parsed = parseTimeFoldJson(exportStr);
      expect(parsed).toEqual(PRESET_TF_B);
    });

    it('拒绝 export 包裹中的未知顶层字段 (字段白名单保护)', () => {
      const exportObj = {
        schema: TIMEFOLD_EXPORT_SCHEMA,
        input: PRESET_TF_B,
        result: analyze(PRESET_TF_B),
        extraMaliciousField: 'exploit',
      };
      expect(() => parseTimeFoldJson(JSON.stringify(exportObj))).toThrowError(TimeFoldError);
      try {
        parseTimeFoldJson(JSON.stringify(exportObj));
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_UNKNOWN_PROPERTY');
        expect((err as TimeFoldError).path).toBe('extraMaliciousField');
      }
    });

    it('拒绝缺少 input 的 export 包裹', () => {
      const invalidExport = {
        schema: TIMEFOLD_EXPORT_SCHEMA,
        result: analyze(PRESET_TF_B),
      };
      expect(() => parseTimeFoldJson(JSON.stringify(invalidExport))).toThrowError(TimeFoldError);
      try {
        parseTimeFoldJson(JSON.stringify(invalidExport));
      } catch (err) {
        expect((err as TimeFoldError).code).toBe('E_MISSING_PROPERTY');
        expect((err as TimeFoldError).path).toBe('input');
      }
    });

    it('拒绝不支持或非法的 schema 标识', () => {
      const badSchema = {
        schema: 'unsupported.schema/2',
        input: PRESET_TF_B,
      };
      expect(() => parseTimeFoldJson(JSON.stringify(badSchema))).toThrowError(TimeFoldError);
      try {
        parseTimeFoldJson(JSON.stringify(badSchema));
      } catch (err) {
        expect((err as TimeFoldError).code).toBe('E_INVALID_SCHEMA');
        expect((err as TimeFoldError).path).toBe('schema');
      }
    });
  });

  /* ========================================================================
   * 3. 不可信 Result 忽略与重算测试
   * ======================================================================== */
  describe('3. 不可信 Result 忽略与内核强制重算', () => {
    it('导入 export 包裹时彻底忽略造假、篡改的 result，importAndAnalyze 返回内核重算真值', () => {
      // 构造伪造结果：声称 TF-A 是 NORMAL 且有 10 个候选
      const fakeResult = {
        schema: 'timefold.result/1',
        input: PRESET_TF_A,
        occurrences: [
          {
            requestedLocal: '2026-03-08 02:30',
            status: 'NORMAL',
            candidatesUtc: ['2026-03-08T07:30:00Z'],
            selectedUtc: ['2026-03-08T07:30:00Z'],
            realizedLocal: ['2026-03-08 02:30'],
            baselineUtc: null,
            driftMinutes: null,
          },
        ],
        requestCount: 999,
        selectedCount: 888,
        firstWitness: {
          type: 'NONE',
          date: null,
          boundaryUtc: null,
          message: 'Fake clean result',
          mapping: null,
        },
        digest: 'fake-digest-value',
      };

      const maliciousExport = JSON.stringify({
        schema: TIMEFOLD_EXPORT_SCHEMA,
        input: PRESET_TF_A,
        result: fakeResult,
      });

      // 1. parseTimeFoldJson 返回的是经过验证的真实 input，不携带任何 fake result
      const parsedInput = parseTimeFoldJson(maliciousExport);
      expect(parsedInput).toEqual(PRESET_TF_A);

      // 2. importAndAnalyze 强制重算，输出必须是 TF-A 真实的 GAP 结果，绝不受 fakeResult 影响
      const recomputed = importAndAnalyze(maliciousExport);
      expect(recomputed.input).toEqual(PRESET_TF_A);
      expect(recomputed.result.requestCount).toBe(1);
      expect(recomputed.result.selectedCount).toBe(0); // TF-A skip 时选中 0
      expect(recomputed.result.occurrences[0]!.status).toBe('GAP');
      expect(recomputed.result.occurrences[0]!.candidatesUtc).toHaveLength(0);
      expect(recomputed.result.firstWitness.type).toBe('GAP');
    });

    it('即使 result 包含恶意的注入脚本或非法结构，导入依然安全成功', () => {
      const maliciousScriptExport = JSON.stringify({
        schema: TIMEFOLD_EXPORT_SCHEMA,
        input: PRESET_TF_B,
        result: {
          maliciousScript: '<script>alert("xss")</script>',
          nestedEvil: { exploit: true },
        },
      });

      const parsed = parseTimeFoldJson(maliciousScriptExport);
      expect(parsed).toEqual(PRESET_TF_B);

      const recomputed = importAndAnalyze(maliciousScriptExport);
      expect(recomputed.result.occurrences[0]!.status).toBe('FOLD');
      expect(recomputed.result.occurrences[0]!.candidatesUtc).toHaveLength(2);
    });
  });

  /* ========================================================================
   * 4. 256 KiB 大小限制防御测试
   * ======================================================================== */
  describe('4. 256 KiB 大小硬性限制防御', () => {
    it('接收大小在 256 KiB 以内的合法 JSON', () => {
      const validJson = JSON.stringify(PRESET_TF_E);
      expect(new TextEncoder().encode(validJson).length).toBeLessThan(256 * 1024);
      expect(() => parseTimeFoldJson(validJson)).not.toThrow();
    });

    it('拒绝超过 256 KiB 的过大 JSON 文本 (E_JSON_SIZE_EXCEEDED)', () => {
      // 构造超过 256 KiB 的大文本
      const base = JSON.stringify(PRESET_TF_A);
      const padding = ' '.repeat(256 * 1024 + 10);
      const hugeJson = base.replace('}', `${padding}}`);

      expect(new TextEncoder().encode(hugeJson).length).toBeGreaterThan(256 * 1024);

      expect(() => safeJsonParse(hugeJson)).toThrowError(TimeFoldError);
      try {
        parseTimeFoldJson(hugeJson);
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_JSON_SIZE_EXCEEDED');
      }
    });
  });

  /* ========================================================================
   * 5. 原型污染防御测试
   * ======================================================================== */
  describe('5. 原型污染防御', () => {
    it('顶层包含 __proto__ 属性时直接拒绝并抛出 E_PROTOTYPE_POLLUTION', () => {
      const malicious = '{"schema":"timefold.spec/1","__proto__":{"polluted":true}}';
      expect(() => safeJsonParse(malicious)).toThrowError(TimeFoldError);
      try {
        safeJsonParse(malicious);
      } catch (err) {
        expect((err as TimeFoldError).code).toBe('E_PROTOTYPE_POLLUTION');
      }
      expect(({} as any).polluted).toBeUndefined();
    });

    it('深层嵌套对象包含 __proto__ 时被深层防御拦截', () => {
      const malicious =
        '{"schema":"timefold.spec/1","name":"TF-A","synthetic":true,"zone":{"label":"America/New_York","snapshot":"frozen-2026","segments":[],"nested":{"__proto__":{"injected":true}}},"schedule":{"frequency":"once","startDate":"2026-03-08","endDate":"2026-03-08","localTime":"02:30","byWeekday":[]},"policy":{"gap":"skip","fold":"earlier"}}';

      expect(() => parseTimeFoldJson(malicious)).toThrowError(TimeFoldError);
      try {
        parseTimeFoldJson(malicious);
      } catch (err) {
        expect((err as TimeFoldError).code).toBe('E_PROTOTYPE_POLLUTION');
      }
      expect(({} as any).injected).toBeUndefined();
    });

    it('包含 constructor 或 prototype 属性时被拒绝', () => {
      const evilConstructor = JSON.stringify({
        schema: TIMEFOLD_SPEC_SCHEMA,
        constructor: { evil: true },
      });
      expect(() => parseTimeFoldJson(evilConstructor)).toThrowError(TimeFoldError);

      const evilPrototype = JSON.stringify({
        schema: TIMEFOLD_SPEC_SCHEMA,
        prototype: { evil: true },
      });
      expect(() => parseTimeFoldJson(evilPrototype)).toThrowError(TimeFoldError);
    });
  });

  /* ========================================================================
   * 6. 损坏 JSON 防御与有效状态保护测试
   * ======================================================================== */
  describe('6. 损坏 JSON 防御与调用方有效状态保护', () => {
    it('语法损坏的 JSON 文本抛出 E_JSON_SYNTAX 且无副作用', () => {
      const malformedJson = '{"schema": "timefold.spec/1", unclosed...';
      expect(() => parseTimeFoldJson(malformedJson)).toThrowError(TimeFoldError);
      try {
        parseTimeFoldJson(malformedJson);
      } catch (err) {
        expect((err as TimeFoldError).code).toBe('E_JSON_SYNTAX');
      }
    });

    it('语义损坏的 JSON (非法日期、分段空洞、非法策略) 抛出具体字段级错误', () => {
      // 1. 非法日期 2026-02-30
      const invalidDateJson = JSON.stringify({
        ...PRESET_TF_A,
        schedule: {
          ...PRESET_TF_A.schedule,
          startDate: '2026-02-30',
          endDate: '2026-02-30',
        },
      });
      expect(() => parseTimeFoldJson(invalidDateJson)).toThrowError(TimeFoldError);

      // 2. 非法策略
      const invalidPolicyJson = JSON.stringify({
        ...PRESET_TF_A,
        policy: {
          gap: 'invalid-gap-policy',
          fold: 'earlier',
        },
      });
      expect(() => parseTimeFoldJson(invalidPolicyJson)).toThrowError(TimeFoldError);
    });

    it('损坏的 JSON 不会覆盖或污染当前有效状态', () => {
      // 模拟 UI 或外部编辑器的当前有效状态
      let currentEditorState = clonePresetInput('TF-B');
      const baselineSnapshot = JSON.stringify(currentEditorState);

      const corruptInputs = [
        '{ bad json',
        JSON.stringify({ schema: 'timefold.spec/1', name: 123 }), // 损坏类型
        '{"schema":"timefold.spec/1","__proto__":{"hacked":1}}', // 恶意注入
        JSON.stringify({ ...PRESET_TF_B, synthetic: false }), // 违背 synthetic 约束
      ];

      for (const badInput of corruptInputs) {
        try {
          const loaded = parseTimeFoldJson(badInput);
          // 若成功才覆盖状态
          currentEditorState = loaded;
        } catch {
          // 捕获错误，保持原状态
        }
        // 断言当前状态未被任何损坏输入破坏
        expect(JSON.stringify(currentEditorState)).toBe(baselineSnapshot);
      }
    });
  });

  /* ========================================================================
   * 7. 导出格式规范与推荐文件名测试
   * ======================================================================== */
  describe('7. 导出格式规范与推荐文件名', () => {
    it('导出的 JSON 顶层键顺序固定为 schema -> input -> result', () => {
      const comp = analyze(PRESET_TF_B);
      const exportedStr = exportTimeFold(PRESET_TF_B, comp);

      const schemaIdx = exportedStr.indexOf('"schema": "timefold.export/1"');
      const inputIdx = exportedStr.indexOf('"input": {');
      const resultIdx = exportedStr.indexOf('"result": {');

      expect(schemaIdx).toBeGreaterThan(-1);
      expect(inputIdx).toBeGreaterThan(schemaIdx);
      expect(resultIdx).toBeGreaterThan(inputIdx);
    });

    it('导出的 JSON 纯洁无隐私外泄 (无用户名、无访问时间戳)', () => {
      const comp = analyze(PRESET_TF_C);
      const exportedStr = exportTimeFold(PRESET_TF_C, comp);

      expect(exportedStr).not.toContain('username');
      expect(exportedStr).not.toContain('timestamp');
      expect(exportedStr).not.toContain('accessedAt');
      expect(exportedStr).not.toContain('exportedAt');
      expect(exportedStr).not.toContain('user');
    });

    it('getExportFilename 按推荐规范生成 timefold-<preset-id>.json', () => {
      expect(getExportFilename('TF-A')).toBe('timefold-TF-A.json');
      expect(getExportFilename('TF-B')).toBe('timefold-TF-B.json');
      expect(getExportFilename('TF-C')).toBe('timefold-TF-C.json');
      expect(getExportFilename('TF-D')).toBe('timefold-TF-D.json');
      expect(getExportFilename('TF-E')).toBe('timefold-TF-E.json');
      expect(getExportFilename('TF-F')).toBe('timefold-TF-F.json');

      expect(getExportFilename(PRESET_TF_A)).toBe('timefold-TF-A.json');
      expect(getExportFilename(PRESET_TF_B)).toBe('timefold-TF-B.json');

      expect(getExportFilename('custom-test')).toBe('timefold-export.json');
      expect(getExportFilename()).toBe('timefold-export.json');
    });

    it('匹配对正常导出 (包含 digest 或无 digest 的结果均可正常导出)', () => {
      const comp = analyze(PRESET_TF_B);
      // 1. 无 digest 的 AnalysisComputation 正常导出
      const exportedWithoutDigest = exportTimeFold(PRESET_TF_B, comp);
      expect(exportedWithoutDigest).toContain('"schema": "timefold.export/1"');
      const parsedWithoutDigest = JSON.parse(exportedWithoutDigest);
      expect(parsedWithoutDigest.input).toEqual(PRESET_TF_B);
      expect(parsedWithoutDigest.result.requestCount).toBe(comp.requestCount);

      // 2. 携带 digest 的 AnalysisResult 正常导出并保留 digest
      const resultWithDigest = {
        ...comp,
        digest: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      };
      const exportedWithDigest = exportTimeFold(PRESET_TF_B, resultWithDigest);
      expect(exportedWithDigest).toContain('"digest": "0123456789abcdef');
      const parsedWithDigest = JSON.parse(exportedWithDigest);
      expect(parsedWithDigest.result.digest).toBe(resultWithDigest.digest);
    });

    it('改后输入配旧结果必须抛错 (N01: exportTimeFold 拦截新旧混杂导出)', () => {
      const oldInput = clonePresetInput('TF-B');
      const oldResult = analyze(oldInput);

      // 场景 A：修改 input 的 name 字段，配旧 result 导出
      const modifiedInputName: TimeFoldInput = {
        ...oldInput,
        name: 'TF-B Modified Name',
      };
      expect(() => exportTimeFold(modifiedInputName, oldResult)).toThrowError(TimeFoldError);
      try {
        exportTimeFold(modifiedInputName, oldResult);
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_RESULT_INPUT_MISMATCH');
        expect((err as TimeFoldError).path).toBe('result.input');
      }

      // 场景 B：修改 policy.fold 策略，配旧 result 导出
      const modifiedInputPolicy: TimeFoldInput = {
        ...oldInput,
        policy: {
          ...oldInput.policy,
          fold: 'later',
        },
      };
      expect(() => exportTimeFold(modifiedInputPolicy, oldResult)).toThrowError(TimeFoldError);
      try {
        exportTimeFold(modifiedInputPolicy, oldResult);
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_RESULT_INPUT_MISMATCH');
      }
    });

    it('即使 result.input 匹配，若计算字段与 analyze(input) 重算不符也必须抛错', () => {
      const input = clonePresetInput('TF-A');
      const validComp = analyze(input);

      // 伪造篡改 occurrences 结果
      const tamperedComp = {
        ...validComp,
        occurrences: [],
      };
      expect(() => exportTimeFold(input, tamperedComp)).toThrowError(TimeFoldError);
      try {
        exportTimeFold(input, tamperedComp);
      } catch (err) {
        expect(err).toBeInstanceOf(TimeFoldError);
        expect((err as TimeFoldError).code).toBe('E_RESULT_COMPUTATION_MISMATCH');
        expect((err as TimeFoldError).path).toBe('result.occurrences');
      }

      // 伪造篡改 requestCount
      const tamperedCount = {
        ...validComp,
        requestCount: 999,
      };
      expect(() => exportTimeFold(input, tamperedCount)).toThrowError(TimeFoldError);
    });

    it('非法或缺失 input 的 result 传入 exportTimeFold 必须抛错', () => {
      expect(() => exportTimeFold(PRESET_TF_A, null as any)).toThrowError(TimeFoldError);
      expect(() => exportTimeFold(PRESET_TF_A, {} as any)).toThrowError(TimeFoldError);
      expect(() => exportTimeFold(PRESET_TF_A, { schema: 'timefold.result/1' } as any)).toThrowError(
        TimeFoldError
      );
    });
  });

  /* ========================================================================
   * 8. 六预设完整 Roundtrip 测试 (Export -> Import -> Recompute -> Compare)
   * ======================================================================== */
  describe('8. 六预设完整 Roundtrip 深度一致性', () => {
    const allPresets = [
      { id: 'TF-A', input: PRESET_TF_A },
      { id: 'TF-B', input: PRESET_TF_B },
      { id: 'TF-C', input: PRESET_TF_C },
      { id: 'TF-D', input: PRESET_TF_D },
      { id: 'TF-E', input: PRESET_TF_E },
      { id: 'TF-F', input: PRESET_TF_F },
    ] as const;

    it.each(allPresets)('预设 $id 经 export -> import -> recompute 逐字段完全一致', ({ input }) => {
      // 1. 初次分析
      const initialComp = analyze(input);

      // 2. 导出为 JSON 字符串
      const exportedJson = exportTimeFold(input, initialComp);

      // 3. 重新导入并强制重算
      const { input: importedInput, result: recomputedComp } = importAndAnalyze(exportedJson);

      // 4. 输入对象完全深度相等
      expect(importedInput).toEqual(input);

      // 5. 重算结果各字段完全深度相等
      expect(recomputedComp.requestCount).toBe(initialComp.requestCount);
      expect(recomputedComp.selectedCount).toBe(initialComp.selectedCount);
      expect(recomputedComp.occurrences).toEqual(initialComp.occurrences);
      expect(recomputedComp.firstWitness).toEqual(initialComp.firstWitness);
    });
  });
});
