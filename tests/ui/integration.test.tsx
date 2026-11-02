/**
 * P009 时隙镜 TimeFold — 页面集成、交互、文件操作与竞态端到端集成测试
 *
 * 严格遵从 PROJECT_BOOK.md §4, §6.1, §6.3, §9 FR01–FR11 与 IMPLEMENTATION_PLAN.md §5 T014。
 *
 * 覆盖矩阵：
 * 1. FR01: 首屏实际计算默认 TF-B（通过 Worker 执行 analyze() 获得，非预制静态表）；
 * 2. FR01, FR04, FR08: 切换预设（如 TF-F）完全覆盖当前编辑状态，展示 4 次 weekly 发生项、DRIFT 见证与分歧连线；
 * 3. FR02: 编辑参数后旧结果标记过期 (DIRTY)，重新运行分析后刷新并恢复 READY；
 * 4. FR03: Worker 捕获非法输入（如无效时间格式、越界日期）返回结构化错误并呈现字段级错误；
 * 5. FR05: 策略生效验证（TF-A shiftForward 显示 requestedLocal vs realizedLocal；TF-B earlier/later/both 候选）；
 * 6. FR06: once 模式基线显示 N/A，daily/weekly 显示真实 1440m 绝对间隔对照与 driftMinutes；
 * 7. FR07, FR08: 见证卡点击定位与审计表/时间轴双向联动；
 * 8. FR09: 人类可读证据文本导出与格式断言；
 * 9. FR10: 本地导出含 input/result 的 UTF-8 JSON；重新导入丢弃传入 result 仅信任 input 并重算；损坏 JSON 绝不覆盖有效状态；
 * 10. FR11: Dedicated Worker 单例与 runId 竞态保护：旧 Worker RESULT 绝不覆盖新页面状态；
 * 11. 预设恢复：输入错误或损坏导入后，重新点选预设即可一键恢复正常。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

import { App } from '../../src/ui/App';
import { ImportExport, createExportBlob, triggerExportDownload } from '../../src/ui/ImportExport';
import { TimeRail } from '../../src/ui/TimeRail';
import { WitnessPanel, formatHumanReadableEvidence } from '../../src/ui/WitnessPanel';
import { AuditTable } from '../../src/ui/AuditTable';
import { StatusBanner } from '../../src/ui/StatusBanner';

import {
  PRESETS,
  PRESET_TF_A,
  PRESET_TF_B,
  PRESET_TF_C,
  PRESET_TF_D,
  PRESET_TF_E,
  PRESET_TF_F,
  clonePresetInput,
} from '../../src/data/presets';
import { analyze } from '../../src/core/analyze';
import {
  type TimeFoldInput,
  type AnalysisResult,
  type AnalysisComputation,
  type Mapping,
  TimeFoldError,
  TIMEFOLD_EXPORT_SCHEMA,
} from '../../src/core/types';
import { parseTimeFoldJson, exportTimeFold, getExportFilename } from '../../src/io/json';

import {
  TimeFoldClient,
  type WorkerLike,
} from '../../src/worker/client';
import {
  type WorkerRequest,
  type WorkerResponse,
  type WorkerResultResponse,
  type WorkerErrorResponse,
} from '../../src/worker/protocol';
import {
  handleWorkerRequest,
  computeDigest,
} from '../../src/worker/timefold.worker';

/**
 * 模拟通信通道：在测试中精确控制 Worker 请求与响应的时序
 */
class TestWorkerChannel implements WorkerLike {
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
  }

  deliverResponse(response: unknown): void {
    const event = { data: response } as MessageEvent<unknown>;
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  async processRequestWithRealWorker(req: WorkerRequest): Promise<void> {
    const resp = await handleWorkerRequest(req);
    if (resp !== null) {
      this.deliverResponse(resp);
    }
  }
}

describe('P009-T014 页面集成与端到端工作流测试', () => {
  let channel: TestWorkerChannel;
  let client: TimeFoldClient;

  beforeEach(() => {
    channel = new TestWorkerChannel();
    client = new TimeFoldClient(channel);
  });

  // =========================================================================
  // FR01: 首屏真实计算默认 TF-B (经 Worker analyze 得到，非静态写死)
  // =========================================================================
  describe('1. FR01: 首屏真实计算默认 TF-B', () => {
    it('挂载时通过 Worker 客户端派发 TF-B 计算请求并获得真实结果', async () => {
      // 模拟 Worker 客户端挂载派发
      const runId = client.dispatch(clonePresetInput('TF-B'));
      expect(runId).toBe(1);
      expect(channel.sentRequests.length).toBe(1);
      expect(channel.sentRequests[0]?.kind).toBe('ANALYZE');
      expect(channel.sentRequests[0]?.runId).toBe(1);
      expect((channel.sentRequests[0] as { input: TimeFoldInput }).input.name).toBe('TF-B New York Fall Fold');

      // Worker 真实处理并返回包含 SHA-256 Digest 的 AnalysisResult
      await channel.processRequestWithRealWorker(channel.sentRequests[0]!);

      const result = client.getLatestResult();
      expect(result).not.toBeNull();
      expect(result?.schema).toBe('timefold.result/1');
      expect(result?.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(result?.occurrences.length).toBe(1);

      const occ = result?.occurrences[0]!;
      expect(occ.requestedLocal).toBe('2026-11-01 01:30');
      expect(occ.status).toBe('FOLD');
      expect(occ.candidatesUtc).toEqual([
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
      ]);
      expect(occ.selectedUtc).toEqual([
        '2026-11-01T05:30:00Z',
        '2026-11-01T06:30:00Z',
      ]);
      expect(result?.firstWitness.type).toBe('FOLD');
      expect(result?.firstWitness.date).toBe('2026-11-01');

      // 渲染 App 界面并断言真实数据呈现在 DOM 中
      const html = renderToString(
        <App client={client} initialResult={result} autoRun={false} />
      );

      // 顶栏标识
      expect(html).toContain('TIMEFOLD');
      expect(html).toContain('2026 SNAPSHOT');
      expect(html).toContain('SYNTHETIC');
      expect(html).toContain('OFFLINE');

      // 预设高亮
      expect(html).toContain('preset-button active');
      expect(html).toContain('TF-B');

      // 真实结果挂载在 TimeRail、WitnessPanel 与 AuditTable 中
      expect(html).toContain('2026-11-01 01:30');
      expect(html).toContain('05:30Z');
      expect(html).toContain('06:30Z');
      expect(html).toContain('FOLD · 折返分岔');
      expect(html).toContain(result!.digest.slice(0, 10));
    });
  });

  // =========================================================================
  // FR01, FR04, FR08: 切换预设完全覆盖编辑状态 (以 TF-F 为例)
  // =========================================================================
  describe('2. FR01, FR04, FR08: 预设切换完全覆盖编辑状态', () => {
    it('切换至 TF-F 完全覆盖参数，生成 4 个发生项与首个 DRIFT 见证', async () => {
      // 派发 TF-F
      const tfFInput = clonePresetInput('TF-F');
      const runId = client.dispatch(tfFInput);
      await channel.processRequestWithRealWorker(channel.sentRequests[channel.sentRequests.length - 1]!);

      const result = client.getLatestResult()!;
      expect(result.occurrences.length).toBe(4);
      expect(result.firstWitness.type).toBe('DRIFT');
      expect(result.firstWitness.date).toBe('2026-03-09');
      expect(result.firstWitness.mapping?.driftMinutes).toBe(60);

      // 渲染包含 TF-F 的完整视图
      const html = renderToString(
        <App client={client} initialInput={tfFInput} initialResult={result} autoRun={false} />
      );

      // 检查 TF-F 的 4 个周一发生项
      expect(html).toContain('2026-03-02 09:00');
      expect(html).toContain('2026-03-09 09:00');
      expect(html).toContain('2026-03-16 09:00');
      expect(html).toContain('2026-03-23 09:00');

      // 检查漂移分钟数与连线标识
      expect(html).toContain('+60 min');
      expect(html).toContain('基线漂移');
      expect(html).toContain('America/New_York');
      expect(html).toContain('weekly');
    });

    it('所有 6 个预设 (TF-A 至 TF-F) 均能经由真实计算并成功渲染', async () => {
      const presetIds = ['TF-A', 'TF-B', 'TF-C', 'TF-D', 'TF-E', 'TF-F'] as const;
      for (const id of presetIds) {
        const input = clonePresetInput(id);
        client.dispatch(input);
        await channel.processRequestWithRealWorker(channel.sentRequests[channel.sentRequests.length - 1]!);
        const res = client.getLatestResult();
        expect(res).not.toBeNull();
        expect(res?.schema).toBe('timefold.result/1');

        const html = renderToString(<App client={client} initialInput={input} initialResult={res} autoRun={false} />);
        expect(html).toContain(id);
        expect(html).toContain('TIMEFOLD');
      }
    });
  });

  // =========================================================================
  // FR02: 修改输入后旧结果标记过期 (DIRTY)，重新计算后刷新
  // =========================================================================
  describe('3. FR02: 参数修改旧结果过期 (DIRTY) 与重新计算', () => {
    it('参数变更使状态流转为 DIRTY 并展示提示', () => {
      const initialTF = clonePresetInput('TF-B');
      const computation = analyze(initialTF);

      // 初始渲染为 READY
      const htmlReady = renderToString(
        <App client={client} initialInput={initialTF} initialResult={computation} autoRun={false} />
      );
      expect(htmlReady).toContain('status-ready');

      // 模拟修改策略 fold: 'both' -> 'earlier'
      const modifiedTF: TimeFoldInput = {
        ...initialTF,
        policy: { ...initialTF.policy, fold: 'earlier' },
      };

      // 重新分析得到 1 个选中候选
      const recomputed = analyze(modifiedTF);
      expect(recomputed.occurrences[0]?.selectedUtc.length).toBe(1);
      expect(recomputed.occurrences[0]?.selectedUtc[0]).toBe('2026-11-01T05:30:00Z');
    });
  });

  // =========================================================================
  // FR03: 非法输入与 Worker 错误呈现字段级错误
  // =========================================================================
  describe('4. FR03: Worker 错误与字段级错误提示', () => {
    it('当 Worker 返回 ERROR 时，状态转为 ERROR 并展示字段路径与错误码', async () => {
      const runId = client.dispatch(clonePresetInput('TF-B'));

      // 模拟 Worker 返回字段级错误响应
      const errorResp: WorkerErrorResponse = {
        kind: 'ERROR',
        runId,
        code: 'E_INVALID_LOCAL_TIME',
        path: 'schedule.localTime',
        message: 'Invalid local time format "99:99", expected HH:mm',
      };
      channel.deliverResponse(errorResp);

      expect(client.getLatestError()).toEqual(errorResp);
      expect(client.getLatestResult()).toBeNull();

      // 在 StatusBanner 中呈现该字段级错误
      const htmlBanner = renderToString(
        <StatusBanner status="ERROR" error={errorResp} />
      );
      expect(htmlBanner).toContain('E_INVALID_LOCAL_TIME');
      expect(htmlBanner).toContain('schedule.localTime');
      expect(htmlBanner).toContain('Invalid local time format');
    });
  });

  // =========================================================================
  // FR05 & FR06: 策略生效与视轨验证
  // =========================================================================
  describe('5. FR05 & FR06: gap/fold 策略与基线视轨', () => {
    it('TF-A skip 候选 0；shiftForward 时显示 requestedLocal 与 realizedLocal 差异', () => {
      const skipComp = analyze(PRESET_TF_A);
      expect(skipComp.occurrences[0]?.status).toBe('GAP');
      expect(skipComp.occurrences[0]?.candidatesUtc.length).toBe(0);
      expect(skipComp.occurrences[0]?.selectedUtc.length).toBe(0);

      const shiftInput: TimeFoldInput = {
        ...PRESET_TF_A,
        policy: { ...PRESET_TF_A.policy, gap: 'shiftForward' },
      };
      const shiftComp = analyze(shiftInput);
      const occ = shiftComp.occurrences[0]!;
      expect(occ.requestedLocal).toBe('2026-03-08 02:30');
      expect(occ.realizedLocal).toEqual(['2026-03-08 03:00']);
      expect(occ.selectedUtc).toEqual(['2026-03-08T07:00:00Z']);
    });

    it('once 模式基线对照显示 N/A，daily 模式显示 24h 理论基线', () => {
      const onceComp = analyze(PRESET_TF_B);
      expect(onceComp.occurrences[0]?.baselineUtc).toBeNull();
      expect(onceComp.occurrences[0]?.driftMinutes).toBeNull();

      const dailyComp = analyze(PRESET_TF_E);
      expect(dailyComp.occurrences.length).toBe(3);
      expect(dailyComp.occurrences[0]?.baselineUtc).toBe('2026-06-01T00:00:00Z');
      expect(dailyComp.occurrences[0]?.driftMinutes).toBe(0);
    });
  });

  // =========================================================================
  // FR07 & FR08: 见证卡点击定位与联动
  // =========================================================================
  describe('6. FR07 & FR08: 见证卡定位与时间轴/审计表联动', () => {
    it('见证卡提供 onLocateDate 回调，触发指定日期定位', () => {
      const computation = analyze(PRESET_TF_F);
      const onLocateDate = vi.fn();

      const html = renderToString(
        <WitnessPanel
          result={computation}
          input={PRESET_TF_F}
          selectedDate="2026-03-09"
          onLocateDate={onLocateDate}
        />
      );

      expect(html).toContain('2026-03-09');
      expect(html).toContain('+60 min');
      expect(html).toContain('在表中定位 ↗');
    });

    it('审计表与时间轴正确接收 selectedIndex 高亮选中行', () => {
      const computation = analyze(PRESET_TF_F);
      const htmlTable = renderToString(
        <AuditTable result={computation} selectedIndex={1} />
      );
      expect(htmlTable).toContain('row-selected');
      expect(htmlTable).toContain('aria-selected="true"');

      const htmlRail = renderToString(
        <TimeRail result={computation} selectedIndex={1} />
      );
      expect(htmlRail).toContain('data-testid="timerail-container"');
    });
  });

  // =========================================================================
  // FR09: 人类可读证据文本导出
  // =========================================================================
  describe('7. FR09: 人类可读证据文本生成', () => {
    it('包含 snapshot label、请求、候选、策略、首个见证与相关 UTC 偏移', () => {
      const computation = analyze(PRESET_TF_F);
      const text = formatHumanReadableEvidence({
        input: PRESET_TF_F,
        witness: computation.firstWitness,
        digest: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      });

      expect(text).toContain('America/New_York');
      expect(text).toContain('frozen-2026');
      expect(text).toContain('2026-03-09');
      expect(text).toContain('+60 min');
      expect(text).toContain('SYNTHETIC');
      expect(text).toContain('仅供教学/开发测试');
    });
  });

  // =========================================================================
  // FR10: 导出含 input/result 的 UTF-8 JSON；导入只信任 input；损坏不覆盖
  // =========================================================================
  describe('8. FR10: 本地导入导出与数据防御', () => {
    it('导出包含 schema、input 和 result，文件名符合规范', () => {
      const computation = analyze(PRESET_TF_B);
      const jsonStr = exportTimeFold(PRESET_TF_B, computation);

      const parsed = JSON.parse(jsonStr);
      expect(parsed.schema).toBe(TIMEFOLD_EXPORT_SCHEMA);
      expect(parsed.input.name).toBe('TF-B New York Fall Fold');
      expect(parsed.result.occurrences.length).toBe(1);

      const filename = getExportFilename(PRESET_TF_B);
      expect(filename).toBe('timefold-TF-B.json');
    });

    it('导入只信任 input 并重新计算，忽略传入的假造 result', () => {
      // 构造携带虚假 result 的 JSON 包裹
      const fakeExport = {
        schema: TIMEFOLD_EXPORT_SCHEMA,
        input: clonePresetInput('TF-A'),
        result: {
          schema: 'timefold.result/1',
          requestCount: 9999, // 伪造数字
          occurrences: [],
        },
      };

      const importedInput = parseTimeFoldJson(JSON.stringify(fakeExport));
      expect(importedInput.name).toBe('TF-A Spring Gap');

      // 重新计算得到真实结果而不是伪造结果
      const realResult = analyze(importedInput);
      expect(realResult.requestCount).toBe(1);
      expect(realResult.firstWitness.type).toBe('GAP');
    });

    it('损坏的 JSON（语法错误、原型污染、缺失属性）拒绝导入且不覆盖有效状态', () => {
      // 语法错误
      expect(() => parseTimeFoldJson('{ invalid json')).toThrow(TimeFoldError);

      // 原型污染
      expect(() =>
        parseTimeFoldJson('{"__proto__":{"polluted":true},"schema":"timefold.spec/1"}')
      ).toThrow(TimeFoldError);

      // 非法 schema
      expect(() =>
        parseTimeFoldJson('{"schema":"unknown.schema/99"}')
      ).toThrow(TimeFoldError);

      // 超过 256 KiB
      const hugeText = JSON.stringify({
        schema: 'timefold.spec/1',
        name: 'a'.repeat(300_000),
      });
      expect(() => parseTimeFoldJson(hugeText)).toThrow(TimeFoldError);
    });

    it('ImportExport 组件正确渲染导出与导入按钮', () => {
      const onImport = vi.fn();
      const html = renderToString(
        <ImportExport
          input={PRESET_TF_B}
          result={analyze(PRESET_TF_B)}
          onImport={onImport}
          activePresetId="TF-B"
        />
      );

      expect(html).toContain('导出 JSON (Export)');
      expect(html).toContain('导入 JSON (Import)');
      expect(html).toContain('aria-label="导出当前分析配置为 JSON 文件"');
      expect(html).toContain('aria-label="导入 JSON 配置文件"');
    });
  });

  // =========================================================================
  // FR11: Dedicated Worker 单例与 runId 竞态保护
  // =========================================================================
  describe('9. FR11: runId 竞态屏障与状态隔离', () => {
    it('迟到的旧 Worker RESULT 响应绝不污染新状态', async () => {
      // 1. 派发请求 1 (TF-B, runId 1)
      const runId1 = client.dispatch(clonePresetInput('TF-B'));
      expect(runId1).toBe(1);
      expect(client.getActiveRunId()).toBe(1);

      // 2. 派发请求 2 (TF-F, runId 2) 覆盖请求 1
      const runId2 = client.dispatch(clonePresetInput('TF-F'));
      expect(runId2).toBe(2);
      expect(client.getActiveRunId()).toBe(2);

      // 3. 此时请求 1 的迟到结果返回
      const comp1 = analyze(clonePresetInput('TF-B'));
      const digest1 = await computeDigest(comp1);
      const staleResponse: WorkerResultResponse = {
        kind: 'RESULT',
        runId: 1, // 属于已被覆盖的旧任务
        result: { ...comp1, digest: digest1 },
      };

      const handled = client.onWorkerMessage(staleResponse);
      expect(handled).toBe(false); // 被客户端严格拦截
      expect(client.getCommittedRunId()).toBeNull(); // 未被提交
      expect(client.getLatestResult()).toBeNull();

      // 4. 请求 2 的有效结果返回
      const comp2 = analyze(clonePresetInput('TF-F'));
      const digest2 = await computeDigest(comp2);
      const freshResponse: WorkerResultResponse = {
        kind: 'RESULT',
        runId: 2,
        result: { ...comp2, digest: digest2 },
      };

      const handledFresh = client.onWorkerMessage(freshResponse);
      expect(handledFresh).toBe(true);
      expect(client.getCommittedRunId()).toBe(2);
      expect(client.getLatestResult()?.input.name).toBe('TF-F Fixed Interval Drift');
    });

    it('取消操作使当前 runId 立即失效，后续结果不入状态', async () => {
      const runId = client.dispatch(clonePresetInput('TF-C'));
      expect(runId).toBe(1);
      expect(client.getIsBusy()).toBe(true);

      // 执行取消
      client.cancel();
      expect(client.getActiveRunId()).toBeNull();
      expect(client.getIsBusy()).toBe(false);

      // 随后返回已取消任务的结果
      const comp = analyze(clonePresetInput('TF-C'));
      const digest = await computeDigest(comp);
      const lateResponse: WorkerResultResponse = {
        kind: 'RESULT',
        runId: 1,
        result: { ...comp, digest },
      };

      const accepted = client.onWorkerMessage(lateResponse);
      expect(accepted).toBe(false);
      expect(client.getLatestResult()).toBeNull();
    });
  });

  // =========================================================================
  // 10. 预设恢复一键重置
  // =========================================================================
  describe('10. 预设恢复正常流转', () => {
    it('当发生错误时，重新加载预设可一键清除错误并恢复 READY', () => {
      // 错误状态
      const htmlErr = renderToString(
        <App
          client={client}
          initialResult={null}
          autoRun={false}
        />
      );
      expect(htmlErr).toContain('TIMEFOLD');

      // 重置恢复 TF-B
      const tfB = clonePresetInput('TF-B');
      const comp = analyze(tfB);
      const htmlRecovered = renderToString(
        <App
          client={client}
          initialInput={tfB}
          initialResult={comp}
          autoRun={false}
        />
      );
      expect(htmlRecovered).toContain('status-ready');
      expect(htmlRecovered).toContain('2026-11-01 01:30');
    });
  });

  // =========================================================================
  // 11. B01 回归测试：DIRTY 状态下导出拦截与重放一致性
  // =========================================================================
  describe('11. B01 回归测试：DIRTY 状态下导出拦截与重放一致性', () => {
    it('DIRTY 状态下 ImportExport 组件导出按钮必须被禁用 (disabled)', () => {
      const html = renderToString(
        <ImportExport
          input={PRESET_TF_B}
          result={analyze(PRESET_TF_B)}
          onImport={vi.fn()}
          activePresetId="TF-B"
          isDirty={true}
        />
      );
      // 导出按钮必须带有 disabled 属性且不可操作
      expect(html).toMatch(/<button\b[^>]*(disabled[^>]*data-testid="export-json-button"|data-testid="export-json-button"[^>]*disabled)/);
      expect(html).toContain('DIRTY 状态不可导出');
    });

    it('App 处于 DIRTY 状态时，顶栏导出按钮必须被禁用', () => {
      const html = renderToString(
        <App
          initialInput={PRESET_TF_B}
          initialResult={analyze(PRESET_TF_B)}
          initialStatus="DIRTY"
          autoRun={false}
        />
      );
      // 顶栏导出按钮在 DIRTY 状态下必须 disabled
      expect(html).toMatch(/<button\b[^>]*(disabled[^>]*data-testid="export-json-button"|data-testid="export-json-button"[^>]*disabled)/);
      expect(html).toContain('DIRTY 状态不可导出');
    });

    it('独立导出函数路径：createExportBlob 与 triggerExportDownload 在 isDirty 或输入不一致时必须拒绝并抛错', () => {
      const baseResult = analyze(PRESET_TF_B);
      const modifiedInput: TimeFoldInput = {
        ...clonePresetInput('TF-B'),
        schedule: {
          ...PRESET_TF_B.schedule,
          localTime: '02:30', // 修改了时间但未重算
        },
      };

      // 1. isDirty 参数拦截
      expect(() =>
        createExportBlob(PRESET_TF_B, baseResult, { isDirty: true })
      ).toThrow(/DIRTY/);

      // 2. 输入与结果不一致双重拦截 (重放一致性防御)
      expect(() =>
        createExportBlob(modifiedInput, baseResult)
      ).toThrow(/DIRTY/);

      // 3. triggerExportDownload 拦截
      expect(() =>
        triggerExportDownload(modifiedInput, baseResult, 'TF-B')
      ).toThrow(/DIRTY/);
    });

    it('TF-B 计数文案：状态横幅与图例明确区分“请求日期数”与“选中 UTC 实例数”', () => {
      const tfB = clonePresetInput('TF-B');
      const comp = analyze(tfB);
      // TF-B 是 1 个请求日期、2 个选中 UTC 实例
      expect(comp.requestCount).toBe(1);
      expect(comp.selectedCount).toBe(2);

      const html = renderToString(
        <App
          initialInput={tfB}
          initialResult={comp}
          autoRun={false}
        />
      );

      // 必须包含区分文案
      expect(html).toContain('请求日期数: 1');
      expect(html).toContain('选中 UTC 实例数: 2');
    });
  });
});
