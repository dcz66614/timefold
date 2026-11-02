/**
 * P009 时隙镜 TimeFold — 主界面应用程序框架
 * 严格遵从 PROJECT_BOOK.md §4.1, §4.2, §4.3, §6.3, §9 FR01–FR11 与 TASK-P009-T014。
 *
 * 核心架构与集成工作流：
 * 1. 顶栏：TIMEFOLD / P009 / 2026 SNAPSHOT / SYNTHETIC / OFFLINE 标识与 ImportExport 导入导出。
 * 2. 预设条：TF-A..TF-F 预设场景切换，默认开箱载入 TF-B 纽约秋季回拨并自动运行计算。
 * 3. 状态横幅：DIRTY / CALCULATING / READY / ERROR 状态流转与青绿/琥珀/珊瑚三色图例（GAP/FOLD/DRIFT/SELECTED）。
 * 4. 三列工作区：
 *    - 左：ScheduleEditor 输入与政策控制面板。
 *    - 中：双轨时间轴 (TimeRail)：展示 0/1/2 分岔、跳时空洞与漂移连线。
 *    - 右：最早差异见证 (WitnessPanel)：展示首个 GAP/FOLD/DRIFT 见证、复制证据与日期定位。
 * 5. 底部区域：
 *    - 底：逐实例审计表 (AuditTable)：展开逐行映射、双向高亮与 SHA-256 Digest 校验。
 * 6. 健壮性与竞态屏障：
 *    - 唯一 Dedicated Worker 通信与递增 runId 关联；
 *    - 迟到响应与过期结果严格屏蔽，不污染新页面；
 *    - 导入只信任 input 并重新计算，损坏 JSON 绝不覆盖当前有效状态；
 *    - 见证卡、时间轴与审计表双向高亮联动；
 *    - 同时兼容 AnalysisResult (含 digest) 与 AnalysisComputation (无 digest) 结果类型。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './styles.css';

import type {
  TimeFoldInput,
  AnalysisResult,
  AnalysisComputation,
  Mapping,
} from '../core/types';
import { TimeFoldError } from '../core/types';
import { clonePresetInput, type PresetId } from '../data/presets';
import { parseTimeFoldJson } from '../io/json';
import { analyze } from '../core/analyze';

import { PresetBar } from './PresetBar';
import { StatusBanner, type UiStatus, type UiErrorDetail } from './StatusBanner';
import { ScheduleEditor } from './ScheduleEditor';
import { TimeRail } from './TimeRail';
import { WitnessPanel } from './WitnessPanel';
import { AuditTable } from './AuditTable';
import { ImportExport } from './ImportExport';
import { getSharedClient, TimeFoldClient } from '../worker/client';
import type { WorkerErrorResponse } from '../worker/protocol';

export interface AppProps {
  /** 可注入的 Dedicated Worker 客户端（测试或自定义 Worker 模拟） */
  client?: TimeFoldClient;
  /** 初始输入配置（默认克隆 TF-B 纽约秋季回拨） */
  initialInput?: TimeFoldInput;
  /** 初始计算结果（默认 null） */
  initialResult?: AnalysisResult | AnalysisComputation | null;
  /** 初始状态机状态（默认 READY） */
  initialStatus?: UiStatus;
  /** 是否在挂载后自动触发初始计算（默认 true） */
  autoRun?: boolean;
}

export function App({
  client: injectedClient,
  initialInput,
  initialResult = null,
  initialStatus = 'READY',
  autoRun = true,
}: AppProps = {}): React.JSX.Element {
  // 1. 初始预设按 §4.1 约定：默认加载 TF-B 纽约秋季回拨
  const [activePresetId, setActivePresetId] = useState<PresetId | null>(() => {
    if (initialInput) {
      const match = initialInput.name.match(/\bTF-[A-F]\b/i);
      return match ? (match[0].toUpperCase() as PresetId) : null;
    }
    return 'TF-B';
  });

  const [input, setInput] = useState<TimeFoldInput>(
    () => initialInput ?? clonePresetInput('TF-B')
  );

  // 2. 状态机：READY / DIRTY / CALCULATING / ERROR
  const [status, setStatus] = useState<UiStatus>(initialStatus);
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined);
  const [errorDetail, setErrorDetail] = useState<UiErrorDetail | null>(null);

  // 3. 计算结果与多组件联动高亮状态
  const [result, setResult] = useState<AnalysisResult | AnalysisComputation | null>(initialResult);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // 4. Worker 客户端单例引用管理（全仓唯一 Dedicated Worker 创建点位于 client.ts）
  const clientRef = useRef<TimeFoldClient | null>(injectedClient || null);

  const getClient = useCallback((): TimeFoldClient | null => {
    if (injectedClient) return injectedClient;
    if (!clientRef.current) {
      try {
        clientRef.current = getSharedClient();
      } catch {
        return null;
      }
    }
    return clientRef.current;
  }, [injectedClient]);

  // 5. 核心计算派发流程（关联 Worker runId 与竞态防御）
  const runCalculation = useCallback(
    (targetInput: TimeFoldInput, presetLabel?: string) => {
      setStatus('CALCULATING');
      setStatusMessage(
        `正在分析计算 ${presetLabel ? `预设 ${presetLabel}` : targetInput.name}...`
      );
      setErrorDetail(null);

      const client = getClient();
      if (client) {
        client.dispatch(targetInput, {
          onResult: (res) => {
            setResult(res);
            setStatus('READY');
            setStatusMessage(
              `分析计算完成 (READY) — 请求日期数: ${res.requestCount}，选中 UTC 实例数: ${res.selectedCount}`
            );
            setErrorDetail(null);
          },
          onError: (errResp: WorkerErrorResponse) => {
            setStatus('ERROR');
            setErrorDetail({
              code: errResp.code,
              path: errResp.path,
              message: errResp.message,
            });
            setStatusMessage(errResp.message);
          },
          onCancel: () => {
            // 逻辑取消或被更新请求取代，不执行任何污染操作
          },
        });
      } else {
        // 环境兼容降级：SSR 或不支持 Worker 且未注入 client 的环境，使用同步 analyze
        try {
          const computation = analyze(targetInput);
          setResult(computation);
          setStatus('READY');
          setStatusMessage(
            `分析计算完成 (READY) — 请求日期数: ${computation.requestCount}，选中 UTC 实例数: ${computation.selectedCount}`
          );
          setErrorDetail(null);
        } catch (err: unknown) {
          const tfErr = err as Partial<TimeFoldError>;
          setStatus('ERROR');
          setErrorDetail({
            code: tfErr.code || 'E_CALCULATION_FAILED',
            path: tfErr.path,
            message: tfErr.message || '计算失败',
          });
          setStatusMessage(tfErr.message || '计算失败');
        }
      }
    },
    [getClient]
  );

  // 6. 首屏挂载后真实计算默认 TF-B
  useEffect(() => {
    if (autoRun) {
      runCalculation(input, activePresetId || undefined);
    }
    return () => {
      // 卸载时逻辑取消任何待决计算
      const currentClient = getClient();
      if (currentClient) {
        currentClient.cancel();
      }
    };
  }, []); // 仅挂载时触发

  // 7. 预设切换处理：完全覆盖编辑状态并立即重算
  const handleSelectPreset = (presetId: PresetId) => {
    try {
      const cloned = clonePresetInput(presetId);
      setActivePresetId(presetId);
      setInput(cloned);
      setSelectedIndex(null);
      setSelectedDate(null);
      setErrorDetail(null);
      runCalculation(cloned, presetId);
    } catch (err) {
      setStatus('ERROR');
      setErrorDetail({
        code: 'E_PRESET_LOAD',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // 8. 输入参数变动处理：旧结果显示过期 (DIRTY)
  const handleInputChange = (nextInput: TimeFoldInput) => {
    setInput(nextInput);
    setStatus('DIRTY');
    setStatusMessage('输入已更改，待重新计算（DIRTY）');
    setErrorDetail(null);
  };

  // 9. 运行分析处理
  const handleRunAnalysis = () => {
    runCalculation(input, activePresetId || undefined);
  };

  // 10. 重置当前参数
  const handleReset = () => {
    const targetPreset = activePresetId || 'TF-B';
    const cloned = clonePresetInput(targetPreset);
    setActivePresetId(targetPreset);
    setInput(cloned);
    setSelectedIndex(null);
    setSelectedDate(null);
    setErrorDetail(null);
    runCalculation(cloned, targetPreset);
  };

  // 11. 导入 JSON 文件处理：只信任 input 并重算，损坏 JSON 绝不覆盖当前状态
  const handleImportJson = (jsonContent: string) => {
    try {
      const importedInput = parseTimeFoldJson(jsonContent);
      setInput(importedInput);
      setActivePresetId(null); // 自定义输入
      setSelectedIndex(null);
      setSelectedDate(null);
      setErrorDetail(null);
      runCalculation(importedInput);
    } catch (err: unknown) {
      const tfErr = err as Partial<TimeFoldError>;
      setStatus('ERROR');
      setErrorDetail({
        code: tfErr.code || 'E_IMPORT_FAILED',
        path: tfErr.path,
        message: tfErr.message || '导入 JSON 校验未通过',
      });
      setStatusMessage(tfErr.message || '导入 JSON 校验未通过');
    }
  };

  // 12. 联动事件：见证卡定位日期 -> 联动时间轴与审计表
  const handleLocateDate = (date: string) => {
    setSelectedDate(date);
    if (result?.occurrences) {
      const idx = result.occurrences.findIndex((m) => m.requestedLocal.startsWith(date));
      if (idx >= 0) {
        setSelectedIndex(idx);
      }
    }
  };

  // 13. 联动事件：时间轴选择节点 -> 联动审计表与见证卡
  const handleSelectIndex = (idx: number) => {
    setSelectedIndex(idx);
    if (result?.occurrences && result.occurrences[idx]) {
      const occurrence = result.occurrences[idx]!;
      setSelectedDate(occurrence.requestedLocal.split(' ')[0] || null);
    }
  };

  // 14. 联动事件：审计表选择行 -> 联动时间轴与见证卡
  const handleSelectRow = (idx: number, row: Mapping) => {
    setSelectedIndex(idx);
    setSelectedDate(row.requestedLocal.split(' ')[0] || null);
  };

  return (
    <div className="timefold-app-container">
      {/* 顶栏：项目标题、规格徽章与导出导入操作组件 */}
      <header className="top-header" role="banner">
        <div className="brand-section">
          <h1 className="app-title">TIMEFOLD</h1>
          <span className="badge-tag badge-project">P009</span>
          <span className="badge-tag badge-snapshot">2026 SNAPSHOT</span>
          <span className="badge-tag badge-synthetic">SYNTHETIC</span>
          <span className="badge-tag badge-offline">OFFLINE</span>
        </div>
        <div className="top-actions">
          <ImportExport
            input={input}
            result={result}
            onImport={handleImportJson}
            activePresetId={activePresetId}
            disabled={status === 'CALCULATING'}
            isDirty={status === 'DIRTY'}
            status={status}
          />
        </div>
      </header>

      {/* 预设选择条 */}
      <PresetBar
        activePresetId={activePresetId}
        onSelectPreset={handleSelectPreset}
        disabled={status === 'CALCULATING'}
      />

      {/* 状态与图例横幅 */}
      <StatusBanner
        status={status}
        statusMessage={statusMessage}
        error={errorDetail}
        counts={
          result
            ? {
                requestCount: result.requestCount,
                selected: result.selectedCount,
              }
            : undefined
        }
      />

      {/* 核心工作区：三列布局（左编辑控制、中时间轴、右见证证据） */}
      <main className="workspace-grid" role="main">
        {/* 左侧：输入与政策控制 */}
        <section aria-label="输入与调度政策区">
          <ScheduleEditor
            input={input}
            onChange={handleInputChange}
            onRun={handleRunAnalysis}
            onReset={handleReset}
            onImport={handleImportJson}
            isCalculating={status === 'CALCULATING'}
            isDirty={status === 'DIRTY'}
          />
        </section>

        {/* 中间：双轨时间轴（计算完成后真实挂载 TimeRail，未就绪时展示占位） */}
        {result ? (
          <section
            className="timefold-panel"
            aria-label="双轨时间轴区域"
            data-testid="timerail-panel"
          >
            <div className="panel-header-title">
              <span>中：双轨时间轴 (TimeRail)</span>
              <span className="badge-tag badge-snapshot">2026 双轨对照</span>
            </div>
            <TimeRail
              result={result}
              selectedIndex={selectedIndex}
              onSelectIndex={handleSelectIndex}
              timeZoneLabel={input.zone.label}
            />
          </section>
        ) : (
          <section
            className="timefold-panel"
            aria-label="双轨时间轴区域（占位）"
          >
            <div className="panel-header-title">
              <span>中：双轨时间轴 (TimeRail 占位)</span>
              <span className="badge-tag badge-snapshot">T012 施工挂载</span>
            </div>
            <div className="placeholder-box">
              <span className="placeholder-badge">TIME RAIL PLACEHOLDER</span>
              <h3 className="placeholder-lead">双轨时间轴等待接入 (TimeRail)</h3>
              <p className="placeholder-sub">
                本地时间轨与 UTC 绝对时间轨双轨对照。将精确可视化展现 0/1/2 反像分岔弧、跳时空洞虚线与漂移连线。
              </p>
              <div className="placeholder-features">
                <span className="placeholder-tag">本地轨 &amp; UTC 轨</span>
                <span className="placeholder-tag">漏时空洞 (GAP)</span>
                <span className="placeholder-tag">回拨分岔 (FOLD)</span>
                <span className="placeholder-tag">漂移连线 (DRIFT)</span>
                <span className="placeholder-tag">Hover 精确时刻</span>
              </div>
            </div>
          </section>
        )}

        {/* 右侧：最早见证证据（计算完成后真实挂载 WitnessPanel，未就绪时展示占位） */}
        {result ? (
          <WitnessPanel
            result={result}
            input={input}
            selectedDate={selectedDate}
            onLocateDate={handleLocateDate}
          />
        ) : (
          <aside
            className="timefold-panel"
            aria-label="最早差异证据区域（占位）"
          >
            <div className="panel-header-title">
              <span>右：最早见证证据 (WitnessPanel 占位)</span>
              <span className="badge-tag badge-snapshot">T013 施工挂载</span>
            </div>
            <div className="placeholder-box">
              <span className="placeholder-badge">WITNESS PLACEHOLDER</span>
              <h3 className="placeholder-lead">首个异常见证证据 (WitnessPanel)</h3>
              <p className="placeholder-sub">
                自动探测首个 GAP、FOLD 或 DRIFT≠0 的见证日期、分段边界、候选决策与基线对照。
              </p>
              <div className="placeholder-features">
                <span className="placeholder-tag">首个异常日期</span>
                <span className="placeholder-tag">请求/候选/决策</span>
                <span className="placeholder-tag">基线漂移分钟</span>
                <span className="placeholder-tag">一键复制证据</span>
              </div>
            </div>
          </aside>
        )}
      </main>

      {/* 底部：逐实例审计表（计算完成后真实挂载 AuditTable，未就绪时展示占位） */}
      {result ? (
        <AuditTable
          result={result}
          selectedIndex={selectedIndex}
          onSelectIndex={handleSelectIndex}
          onSelectRow={handleSelectRow}
          firstWitnessDate={result.firstWitness?.date}
        />
      ) : (
        <footer
          className="bottom-audit-panel"
          role="contentinfo"
          aria-label="逐实例审计表区域（占位）"
        >
          <div className="panel-header-title">
            <span>底：逐实例审计表 / 模型边界 / 错误详情 / 可复现实验 ID (AuditTable 占位)</span>
            <span className="badge-tag badge-snapshot">T013 施工挂载</span>
          </div>
          <div className="audit-placeholder-box">
            <p className="placeholder-sub">
              逐实例展开映射明细：请求时间、候选 UTC 集合、决策结果、基线对照时间、漂移分钟数与 SHA-256 结果校验摘要 (AuditTable)。
            </p>
            <div className="placeholder-features">
              <span className="placeholder-tag">逐行映射审计</span>
              <span className="placeholder-tag">双向高亮关联</span>
              <span className="placeholder-tag">可复现 SHA-256 Digest</span>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

export default App;
