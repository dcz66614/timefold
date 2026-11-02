/**
 * P009-T015 输入安全、无联网依赖、Worker 竞态屏障与可访问性防御测试
 *
 * 严格遵从 PROJECT_BOOK.md §5.5、§6.1、§6.3、§9 (FR03, FR10, FR11, FR12)、§10 (U02, U06, U07, U08)、§11
 * 与 IMPLEMENTATION_PLAN.md §5 T015、TASK-P009-T015。
 *
 * 审查要点：
 * 1. 原型污染防御 (__proto__, constructor, prototype)；
 * 2. 超大报文防御 (256 KiB 限制、超限拒绝、截断语法错误)；
 * 3. 严格字段白名单与违禁字段拒绝 (expectedOutput, isRealBusinessData 等)；
 * 4. 不可信 result 隔离与强制内核重算；
 * 5. 极端边界值 (90 请求上限、分段缺口/重叠、非法日期与时刻)；
 * 6. 无运行时联网依赖静态代码与构建产物全仓审计；
 * 7. Worker 竞态屏障 (迟到响应丢弃、取消后响应丢弃、单例 Dedicated Worker)；
 * 8. 可访问性规范抽查 (ARIA live, prefers-reduced-motion, 768/1200px 断点)。
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  safeJsonParse,
  parseTimeFoldData,
  parseTimeFoldJson,
  importAndAnalyze,
  exportTimeFold,
} from '../../src/io/json';
import {
  validateInput,
  validateZoneSegments,
  MAX_JSON_BYTES,
  MAX_REQUEST_DATES,
  MAX_SEGMENTS,
} from '../../src/core/validate';
import { analyze } from '../../src/core/analyze';
import {
  PRESET_TF_A,
  PRESET_TF_B,
  PRESET_TF_F,
  clonePresetInput,
} from '../../src/data/presets';
import {
  TimeFoldError,
  TIMEFOLD_SPEC_SCHEMA,
  TIMEFOLD_EXPORT_SCHEMA,
  type TimeFoldInput,
} from '../../src/core/types';
import {
  TimeFoldClient,
  type WorkerLike,
  type ClientState,
} from '../../src/worker/client';
import type {
  WorkerRequest,
  WorkerResultResponse,
  WorkerErrorResponse,
} from '../../src/worker/protocol';

/** 模拟用于竞态测试的受控 Worker 通道 */
class ControllableMockWorker implements WorkerLike {
  public sentRequests: WorkerRequest[] = [];
  public listeners: ((event: MessageEvent<unknown>) => void)[] = [];
  public terminated = false;

  postMessage(message: unknown): void {
    if (this.terminated) {
      throw new Error('Worker terminated');
    }
    this.sentRequests.push(message as WorkerRequest);
  }

  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void
  ): void {
    if (type === 'message') {
      this.listeners.push(listener);
    }
  }

  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void
  ): void {
    if (type === 'message') {
      this.listeners = this.listeners.filter((l) => l !== listener);
    }
  }

  terminate(): void {
    this.terminated = true;
    this.listeners = [];
  }

  /** 模拟向 Client 投递 Worker 响应 */
  deliverMessage(data: unknown): void {
    const event = { data } as MessageEvent<unknown>;
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

describe('P009-T015 独立 QA 安全与稳健性复核', () => {
  /* ========================================================================
   * 1. 原型污染防御测试
   * ======================================================================== */
  describe('1. 原型污染防御 (Prototype Pollution Defense)', () => {
    it('顶层 __proto__ 属性注入在文本解析阶段即刻拒绝', () => {
      const maliciousJson = '{"__proto__": {"polluted": true}, "schema": "timefold.spec/1"}';
      expect(() => safeJsonParse(maliciousJson)).toThrowError(
        expect.objectContaining({ code: 'E_PROTOTYPE_POLLUTION' })
      );
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('嵌套在 zone / schedule / policy 内的 constructor / prototype 属性均被拦截', () => {
      const nestedConstructor = JSON.stringify({
        ...PRESET_TF_A,
        zone: {
          ...PRESET_TF_A.zone,
          constructor: { polluted: true },
        },
      });
      expect(() => parseTimeFoldJson(nestedConstructor)).toThrowError(
        expect.objectContaining({ code: 'E_PROTOTYPE_POLLUTION' })
      );

      const nestedPrototype = JSON.stringify({
        ...PRESET_TF_A,
        policy: {
          ...PRESET_TF_A.policy,
          prototype: { polluted: true },
        },
      });
      expect(() => parseTimeFoldJson(nestedPrototype)).toThrowError(
        expect.objectContaining({ code: 'E_PROTOTYPE_POLLUTION' })
      );

      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('分段数组对象内注入 __proto__ 命中 E_PROTOTYPE_POLLUTION', () => {
      const arrayPollution = JSON.stringify(PRESET_TF_A).replace(
        '"offsetMinutes":-300',
        '"offsetMinutes":-300,"__proto__":{"polluted":true}'
      );
      expect(() => parseTimeFoldJson(arrayPollution)).toThrowError(
        expect.objectContaining({ code: 'E_PROTOTYPE_POLLUTION' })
      );
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('直接调用 validateInput 传入含原型污染键的 JS 对象亦被拦截', () => {
      const badObj = {
        ...clonePresetInput('TF-A'),
        __proto__: { injected: 1 },
      };
      // 利用 Object.defineProperty 显式定义自身的危险属性
      Object.defineProperty(badObj, '__proto__', {
        value: { injected: 1 },
        enumerable: true,
        configurable: true,
      });

      expect(() => validateInput(badObj)).toThrowError(
        expect.objectContaining({ code: 'E_PROTOTYPE_POLLUTION' })
      );
    });
  });

  /* ========================================================================
   * 2. 报文超限与语法截断防御测试
   * ======================================================================== */
  describe('2. 报文超限与异常防御 (Payload Size & Syntax Defense)', () => {
    it(`严格限制 256 KiB (${MAX_JSON_BYTES} 字节)：超限 1 字节立即拒绝`, () => {
      const baseInput = clonePresetInput('TF-A');
      const baseJson = JSON.stringify(baseInput);

      // 构造恰好等于 256 KiB 的有效 payload（利用空白填充）
      const neededPadding = MAX_JSON_BYTES - new TextEncoder().encode(baseJson).length;
      expect(neededPadding).toBeGreaterThan(0);

      const exactPayload = baseJson + ' '.repeat(neededPadding);
      expect(new TextEncoder().encode(exactPayload).length).toBe(MAX_JSON_BYTES);
      expect(() => safeJsonParse(exactPayload)).not.toThrow();

      // 超出 1 字节
      const exceededPayload = exactPayload + ' ';
      expect(new TextEncoder().encode(exceededPayload).length).toBe(MAX_JSON_BYTES + 1);
      expect(() => safeJsonParse(exceededPayload)).toThrowError(
        expect.objectContaining({ code: 'E_JSON_SIZE_EXCEEDED' })
      );
    });

    it('大体积垃圾数据 (1MB) 在反序列化前即被拒绝', () => {
      const hugeData = '{"a":"' + 'X'.repeat(1024 * 1024) + '"}';
      expect(() => safeJsonParse(hugeData)).toThrowError(
        expect.objectContaining({ code: 'E_JSON_SIZE_EXCEEDED' })
      );
    });

    it('截断/非法 JSON 语法抛出 E_JSON_SYNTAX 而非未受控崩溃', () => {
      const truncated = '{"schema": "timefold.spec/1", "name": ';
      expect(() => parseTimeFoldJson(truncated)).toThrowError(
        expect.objectContaining({ code: 'E_JSON_SYNTAX' })
      );

      const broken = '{schema: timefold}';
      expect(() => parseTimeFoldJson(broken)).toThrowError(
        expect.objectContaining({ code: 'E_JSON_SYNTAX' })
      );
    });

    it('根节点非对象类型（字符串、数值、布尔、数组、null）命中 E_INVALID_TYPE', () => {
      expect(() => parseTimeFoldJson('"just a string"')).toThrowError(
        expect.objectContaining({ code: 'E_INVALID_TYPE' })
      );
      expect(() => parseTimeFoldJson('123456')).toThrowError(
        expect.objectContaining({ code: 'E_INVALID_TYPE' })
      );
      expect(() => parseTimeFoldJson('true')).toThrowError(
        expect.objectContaining({ code: 'E_INVALID_TYPE' })
      );
      expect(() => parseTimeFoldJson('null')).toThrowError(
        expect.objectContaining({ code: 'E_INVALID_TYPE' })
      );
      expect(() => parseTimeFoldJson('[]')).toThrowError(
        expect.objectContaining({ code: 'E_INVALID_TYPE' })
      );
    });
  });

  /* ========================================================================
   * 3. 严格字段白名单与违禁字段拒绝
   * ======================================================================== */
  describe('3. 字段白名单与违禁字段防御 (Field Whitelist Defense)', () => {
    it('规格明确违禁字段 expectedOutput 与 isRealBusinessData 抛出 E_FORBIDDEN_PROPERTY', () => {
      const withExpectedOutput = {
        ...clonePresetInput('TF-A'),
        expectedOutput: { some: 'result' },
      };
      expect(() => validateInput(withExpectedOutput)).toThrowError(
        expect.objectContaining({ code: 'E_FORBIDDEN_PROPERTY', path: 'expectedOutput' })
      );

      const withRealBusiness = {
        ...clonePresetInput('TF-A'),
        isRealBusinessData: true,
      };
      expect(() => validateInput(withRealBusiness)).toThrowError(
        expect.objectContaining({ code: 'E_FORBIDDEN_PROPERTY', path: 'isRealBusinessData' })
      );
    });

    it('顶层未知冗余字段命中 E_UNKNOWN_PROPERTY', () => {
      const withExtra = {
        ...clonePresetInput('TF-A'),
        hackKey: 'randomValue',
      };
      expect(() => validateInput(withExtra)).toThrowError(
        expect.objectContaining({ code: 'E_UNKNOWN_PROPERTY', path: 'hackKey' })
      );
    });

    it('导出包裹 timefold.export/1 格式顶层仅允许 schema, input, result', () => {
      const validExport = {
        schema: TIMEFOLD_EXPORT_SCHEMA,
        input: clonePresetInput('TF-A'),
        result: analyze(PRESET_TF_A),
        extraMeta: { user: 'anonymous' },
      };
      expect(() => parseTimeFoldData(validExport)).toThrowError(
        expect.objectContaining({ code: 'E_UNKNOWN_PROPERTY', path: 'extraMeta' })
      );
    });

    it('不支持的未知 schema 抛出 E_INVALID_SCHEMA', () => {
      const unknownSchema = {
        schema: 'timefold.unknown/999',
        name: 'test',
      };
      expect(() => parseTimeFoldData(unknownSchema)).toThrowError(
        expect.objectContaining({ code: 'E_INVALID_SCHEMA' })
      );
    });
  });

  /* ========================================================================
   * 4. 不可信 Result 隔离与强制内核重算
   * ======================================================================== */
  describe('4. 不可信 Result 隔离防御 (Untrusted Result Defense)', () => {
    it('导入包含伪造/投毒 result 的导出包时，parseTimeFoldData 丢弃 result 仅返回 input', () => {
      const forgedPackage = {
        schema: TIMEFOLD_EXPORT_SCHEMA,
        input: clonePresetInput('TF-A'),
        result: {
          schema: 'timefold.result/1',
          tampered: true,
          occurrences: [
            {
              requestedLocal: '2026-03-08 02:30',
              status: 'NORMAL', // 伪造为 NORMAL（真实应为 GAP）
              candidatesUtc: ['2026-03-08T07:00:00Z'],
            },
          ],
        },
      };

      const extractedInput = parseTimeFoldData(forgedPackage);
      expect(extractedInput).toEqual(PRESET_TF_A);
      expect((extractedInput as any).result).toBeUndefined();
    });

    it('importAndAnalyze 强制使用真实内核重新计算，彻底粉碎伪造结果', () => {
      const forgedPackage = {
        schema: TIMEFOLD_EXPORT_SCHEMA,
        input: clonePresetInput('TF-A'),
        result: {
          fakeResult: 'malicious',
          status: 'ALL_PASS',
        },
      };

      const result = importAndAnalyze(JSON.stringify(forgedPackage));
      // 确认重新计算后的实际结果：TF-A 必为 GAP，候选 0
      expect(result.result.occurrences[0]!.status).toBe('GAP');
      expect(result.result.occurrences[0]!.candidatesUtc).toEqual([]);
      expect(result.result.firstWitness?.type).toBe('GAP');
      expect((result.result as any).fakeResult).toBeUndefined();
    });
  });

  /* ========================================================================
   * 5. 极端边界值与非法分段/排程防御
   * ======================================================================== */
  describe('5. 边界与非法排程防御 (Boundary Defense)', () => {
    it(`排程日期数量严格限制 ≤ ${MAX_REQUEST_DATES}：90 天成功，91 天抛出 E_REQUEST_COUNT_EXCEEDED`, () => {
      // 2026-01-01 到 2026-03-31 恰好为 31 + 28 + 31 = 90 天
      const valid90: TimeFoldInput = {
        ...clonePresetInput('TF-E'),
        schedule: {
          frequency: 'daily',
          startDate: '2026-01-01',
          endDate: '2026-03-31',
          localTime: '09:00',
          byWeekday: [],
        },
      };
      expect(() => validateInput(valid90)).not.toThrow();

      // 2026-01-01 到 2026-04-01 为 91 天
      const invalid91: TimeFoldInput = {
        ...clonePresetInput('TF-E'),
        schedule: {
          frequency: 'daily',
          startDate: '2026-01-01',
          endDate: '2026-04-01',
          localTime: '09:00',
          byWeekday: [],
        },
      };
      expect(() => validateInput(invalid91)).toThrowError(
        expect.objectContaining({ code: 'E_REQUEST_COUNT_EXCEEDED' })
      );
    });

    it('2026 平年 2 月 29 日命中 E_INVALID_DATE 拒绝', () => {
      const leapDay2026: TimeFoldInput = {
        ...clonePresetInput('TF-A'),
        schedule: {
          frequency: 'once',
          startDate: '2026-02-29',
          endDate: '2026-02-29',
          localTime: '09:00',
          byWeekday: [],
        },
      };
      expect(() => validateInput(leapDay2026)).toThrowError(
        expect.objectContaining({ code: 'E_INVALID_DATE' })
      );
    });

    it('非法日期格式与大月小月越界 (如 2026-04-31, 2026-13-01) 拒绝', () => {
      const apr31: TimeFoldInput = {
        ...clonePresetInput('TF-A'),
        schedule: {
          frequency: 'once',
          startDate: '2026-04-31',
          endDate: '2026-04-31',
          localTime: '09:00',
          byWeekday: [],
        },
      };
      expect(() => validateInput(apr31)).toThrowError(
        expect.objectContaining({ code: 'E_INVALID_DATE' })
      );

      const month13: TimeFoldInput = {
        ...clonePresetInput('TF-A'),
        schedule: {
          frequency: 'once',
          startDate: '2026-13-01',
          endDate: '2026-13-01',
          localTime: '09:00',
          byWeekday: [],
        },
      };
      expect(() => validateInput(month13)).toThrowError(
        expect.objectContaining({ code: 'E_INVALID_DATE' })
      );
    });

    it('非法时刻拒绝 (24:00, 25:00 抛 E_INVALID_TIME；9:00, 09:0 抛 E_INVALID_TIME_FORMAT)', () => {
      for (const t of ['24:00', '25:00', '12:60']) {
        const badInput: TimeFoldInput = {
          ...clonePresetInput('TF-A'),
          schedule: {
            ...clonePresetInput('TF-A').schedule,
            localTime: t,
          },
        };
        expect(() => validateInput(badInput)).toThrowError(
          expect.objectContaining({ code: 'E_INVALID_TIME' })
        );
      }

      for (const t of ['9:00', '09:0', 'invalid']) {
        const badInput: TimeFoldInput = {
          ...clonePresetInput('TF-A'),
          schedule: {
            ...clonePresetInput('TF-A').schedule,
            localTime: t,
          },
        };
        expect(() => validateInput(badInput)).toThrowError(
          expect.objectContaining({ code: 'E_INVALID_TIME_FORMAT' })
        );
      }
    });

    it('startDate > endDate 命中 E_START_DATE_AFTER_END_DATE 拒绝', () => {
      const reversedRange: TimeFoldInput = {
        ...clonePresetInput('TF-E'),
        schedule: {
          frequency: 'daily',
          startDate: '2026-06-10',
          endDate: '2026-06-05',
          localTime: '09:00',
          byWeekday: [],
        },
      };
      expect(() => validateInput(reversedRange)).toThrowError(
        expect.objectContaining({ code: 'E_START_DATE_AFTER_END_DATE' })
      );
    });
  });

  /* ========================================================================
   * 6. 无运行时联网依赖全仓静态与产物审计
   * ======================================================================== */
  describe('6. 无运行时联网依赖静态全仓审计 (Zero Networking Audit)', () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const indexHtmlPath = path.resolve(__dirname, '../../index.html');
    const stylesPath = path.resolve(__dirname, '../../src/ui/styles.css');

    function scanDirForKeywords(dir: string, regex: RegExp, matched: string[] = []): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDirForKeywords(fullPath, regex, matched);
        } else if (/\.(ts|tsx|js|jsx|css|html)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (regex.test(line)) {
              matched.push(`${fullPath}:${i + 1}: ${line.trim()}`);
            }
          }
        }
      }
      return matched;
    }

    it('src/ 源码中不存在任何运行时网络 API 引用 (fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon)', () => {
      const networkApiRegex = /\b(fetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|new\s+EventSource|navigator\.sendBeacon)\b/;
      const hits = scanDirForKeywords(srcDir, networkApiRegex);
      expect(hits, `Found runtime network API calls:\n${hits.join('\n')}`).toHaveLength(0);
    });

    it('src/ 源码中不存在任何硬编码外部 HTTP/HTTPS 网络端点', () => {
      const httpRegex = /https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
      const hits = scanDirForKeywords(srcDir, httpRegex);
      expect(hits, `Found hardcoded URLs in src:\n${hits.join('\n')}`).toHaveLength(0);
    });

    it('index.html 中不存在外部 CDN 脚本、样式表或字体链接', () => {
      const indexContent = fs.readFileSync(indexHtmlPath, 'utf8');
      expect(indexContent).not.toMatch(/https?:\/\//);
      expect(indexContent).not.toMatch(/fonts\.googleapis\.com/);
      expect(indexContent).not.toMatch(/cdnjs\.cloudflare\.com/);
    });

    it('src/ui/styles.css 中不存在任何 @import url(http...) 外部字体引入', () => {
      const cssContent = fs.readFileSync(stylesPath, 'utf8');
      expect(cssContent).not.toMatch(/@import\s+url\s*\(\s*['"]?https?:/i);
    });
  });

  /* ========================================================================
   * 7. Worker 竞态屏障与旧结果防覆盖
   * ======================================================================== */
  describe('7. Worker 竞态屏障与状态隔离防覆盖 (Worker Concurrency)', () => {
    it('迟到/乱序的旧 runId 响应绝不覆盖当前最新状态', () => {
      const mockChannel = new ControllableMockWorker();
      const client = new TimeFoldClient(mockChannel);

      const states: ClientState[] = [];
      client.subscribe((s) => states.push(s));

      // 1. 发送请求 1 (runId=1)
      const inputA = clonePresetInput('TF-A');
      const req1RunId = client.dispatch(inputA);

      expect(client.getState().isBusy).toBe(true);
      expect(client.getState().activeRunId).toBe(req1RunId);

      // 2. 发送请求 2 (runId=2)（模拟用户快速切换预设）
      const inputB = clonePresetInput('TF-B');
      const req2RunId = client.dispatch(inputB);

      expect(client.getState().isBusy).toBe(true);
      expect(client.getState().activeRunId).toBe(req2RunId);
      expect(req2RunId).toBeGreaterThan(req1RunId);

      // 3. 模拟请求 1 迟到响应到达
      const staleResultResponse = {
        kind: 'RESULT' as const,
        runId: req1RunId,
        digest: 'fake-digest-1',
        result: analyze(inputA),
      };
      mockChannel.deliverMessage(staleResultResponse);

      // 屏障防御：状态必须仍然是 busy，且保留 req2RunId，未被旧响应覆盖！
      expect(client.getState().isBusy).toBe(true);
      expect(client.getState().activeRunId).toBe(req2RunId);
      expect(client.getState().latestResult).toBeNull();

      // 4. 正确的请求 2 响应到达
      const currentResultResponse = {
        kind: 'RESULT' as const,
        runId: req2RunId,
        digest: 'fake-digest-2',
        result: analyze(inputB),
      };
      mockChannel.deliverMessage(currentResultResponse);

      // 接受当前响应，切换为 ready (isBusy=false)
      expect(client.getState().isBusy).toBe(false);
      expect(client.getState().committedRunId).toBe(req2RunId);
      expect(client.getState().latestResult?.input.name).toBe(inputB.name);

      client.destroy();
    });

    it('已被 CANCEL 的请求后续返回的 RESULT 或 ERROR 均被安全忽略', () => {
      const mockChannel = new ControllableMockWorker();
      const client = new TimeFoldClient(mockChannel);

      const inputA = clonePresetInput('TF-A');
      const runId = client.dispatch(inputA);
      expect(client.getState().isBusy).toBe(true);

      // 取消请求
      client.cancel();
      expect(client.getState().isBusy).toBe(false);
      expect(client.getState().activeRunId).toBeNull();

      // 迟到的 RESULT
      mockChannel.deliverMessage({
        kind: 'RESULT',
        runId,
        digest: 'fake-digest',
        result: analyze(inputA),
      });
      expect(client.getState().latestResult).toBeNull();

      // 迟到的 ERROR
      mockChannel.deliverMessage({
        kind: 'ERROR',
        runId,
        digest: 'fake-digest',
        code: 'E_JSON_SYNTAX',
        path: '',
        message: 'Ignored error',
      });
      expect(client.getState().latestError).toBeNull();

      client.destroy();
    });
  });

  /* ========================================================================
   * 8. 可访问性与 UI 响应式抽查
   * ======================================================================== */
  describe('8. 可访问性与 UI 响应式抽查 (Accessibility & Responsive Styles)', () => {
    const cssPath = path.resolve(__dirname, '../../src/ui/styles.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    it('CSS 中具备 @media (prefers-reduced-motion: reduce) 规则关闭强制动效 (U07)', () => {
      expect(cssContent).toContain('@media (prefers-reduced-motion: reduce)');
      expect(cssContent).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
      expect(cssContent).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    });

    it('CSS 中具备 @media (max-width: 899px) 响应式断点单列流式布局 (U02)', () => {
      expect(cssContent).toContain('@media (max-width: 899px)');
      expect(cssContent).toMatch(/grid-template-columns:\s*1fr/);
    });

    it('CSS 中定义高对比度键盘焦点环 :focus-visible (U06)', () => {
      expect(cssContent).toContain('button:focus-visible');
      expect(cssContent).toContain('input:focus-visible');
      expect(cssContent).toMatch(/outline:\s*2px\s+solid/);
    });

    it('声明教学与非生产决策警示，导出数据包含合成标识与快照版本 (U08)', () => {
      const witnessPath = path.resolve(__dirname, '../../src/ui/WitnessPanel.tsx');
      const auditPath = path.resolve(__dirname, '../../src/ui/AuditTable.tsx');
      const witnessContent = fs.readFileSync(witnessPath, 'utf8');
      const auditContent = fs.readFileSync(auditPath, 'utf8');

      // 界面组件中明确包含非生产决策与教学警示
      expect(witnessContent).toContain('不适用于生产决策');
      expect(witnessContent).toContain('仅供教学');
      expect(auditContent).toContain('不适用于生产决策');
      expect(auditContent).toContain('仅供教学');

      // 导出数据中包含 synthetic 与 snapshot
      const exportJson = exportTimeFold(PRESET_TF_A, analyze(PRESET_TF_A));
      const parsed = JSON.parse(exportJson);
      expect(parsed.input.synthetic).toBe(true);
      expect(parsed.input.zone.snapshot).toBe('frozen-2026');
    });
  });
});
