/**
 * P009 时隙镜 TimeFold — JSON 导入导出操作组件 (ImportExport)
 *
 * 严格遵从 PROJECT_BOOK.md §5.5, §6.1, §9 FR10 与 IMPLEMENTATION_PLAN.md §5 T014。
 *
 * 核心要求：
 * 1. 导出规范：
 *    - 纯 UTF-8 JSON，包含 schema ("timefold.export/1")、input 与计算结果 result；
 *    - 顶层字段固定顺序 schema -> input -> result，无隐私与环境信息；
 *    - 文件名规范：timefold-<preset-id>.json（如 timefold-TF-B.json）；
 *    - 无论当前 result 是否已计算，若未就绪则纯数学计算降级输出，确保导出格式始终有效。
 * 2. 导入规范：
 *    - 用户选取本地 JSON 文件通过 FileReader 异步读取 UTF-8 文本；
 *    - 安全防御交由 io/json 验证；
 *    - 重新导入时只信任 input 并触发重新计算；
 *    - 损坏 JSON 不覆盖当前有效状态；
 *    - 重置 file input 允许连续选取同一文件。
 * 3. 无障碍与键盘导航：
 *    - 操作按钮具有明确的 aria-label、title 与 tabIndex={0} 键盘高亮支持。
 */

import React, { useRef } from 'react';
import type {
  TimeFoldInput,
  AnalysisResult,
  AnalysisComputation,
} from '../core/types';
import { analyze } from '../core/analyze';
import { exportTimeFold, getExportFilename } from '../io/json';

export interface ImportExportProps {
  /** 当前输入配置 */
  input: TimeFoldInput;
  /** 当前计算结果（兼容带或不带 digest 的结果类型） */
  result?: AnalysisResult | AnalysisComputation | null;
  /** 导入成功回调，传递纯文本 JSON */
  onImport: (jsonContent: string) => void;
  /** 当前激活的预设 ID（若为自定义则为 null） */
  activePresetId?: string | null;
  /** 是否处于正在计算等禁用状态 */
  disabled?: boolean;
  /** 是否处于输入已变动待重算的脏状态 (DIRTY) */
  isDirty?: boolean;
  /** UI 状态机当前状态 */
  status?: 'READY' | 'DIRTY' | 'CALCULATING' | 'ERROR';
  /** 自定义类名 */
  className?: string;
  /** 呈现模式：默认 full (导出与导入按钮全展示) 或 compact */
  mode?: 'full' | 'export-only' | 'import-only';
}

export interface ExportOptions {
  /** 是否标记为 DIRTY 状态（输入已更改未重算） */
  isDirty?: boolean;
}

/**
 * 构造合法的导出 UTF-8 Blob 对象
 */
export function createExportBlob(
  input: TimeFoldInput,
  result?: AnalysisResult | AnalysisComputation | null,
  options?: ExportOptions
): Blob {
  if (options?.isDirty) {
    throw new Error('DIRTY 状态下禁止导出：输入已修改尚未重新计算，请先运行分析以保持重放一致性。');
  }
  // 双重防御：若传入的 result 与当前 input 不一致，判定为脏数据拦截
  if (result && JSON.stringify(result.input) !== JSON.stringify(input)) {
    throw new Error('DIRTY 状态拦截：检测到计算结果与当前输入不一致，禁止导出过期结果。');
  }
  // 若当前尚未取得 Worker 结果，则使用纯数学内核实时生成保障有效导出
  const effectiveResult = result ?? analyze(input);
  const jsonText = exportTimeFold(input, effectiveResult);
  return new Blob([jsonText], {
    type: 'application/json;charset=utf-8',
  });
}

/**
 * 触发本地 JSON 导出文件下载
 */
export function triggerExportDownload(
  input: TimeFoldInput,
  result?: AnalysisResult | AnalysisComputation | null,
  activePresetId?: string | null,
  options?: ExportOptions
): string {
  if (options?.isDirty) {
    throw new Error('DIRTY 状态下禁止导出：输入已修改尚未重新计算，请先运行分析以保持重放一致性。');
  }
  if (result && JSON.stringify(result.input) !== JSON.stringify(input)) {
    throw new Error('DIRTY 状态拦截：检测到计算结果与当前输入不一致，禁止导出过期结果。');
  }
  const filename = getExportFilename(activePresetId || input);
  const blob = createExportBlob(input, result, options);

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return filename;
}

/**
 * 异步读取文件内容为 UTF-8 字符串
 */
export function readJsonFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        resolve(content);
      } else {
        reject(new Error('Failed to read file as text'));
      }
    };
    reader.onerror = () => {
      reject(reader.error || new Error('FileReader encountered an error'));
    };
    reader.readAsText(file, 'utf-8');
  });
}

export function ImportExport({
  input,
  result,
  onImport,
  activePresetId,
  disabled = false,
  isDirty = false,
  status,
  className = '',
  mode = 'full',
}: ImportExportProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isDirtyState = Boolean(isDirty) || status === 'DIRTY';
  const isCalculatingState = Boolean(disabled) || status === 'CALCULATING';
  const isExportDisabled = isCalculatingState || isDirtyState;

  const handleExport = () => {
    if (isExportDisabled) {
      console.warn(
        `[TimeFold 导出拦截] 当前处于 ${isDirtyState ? 'DIRTY' : 'CALCULATING'} 状态，已拦截导出操作以保障 FR10/MATH10 导出重放一致性。`
      );
      return;
    }
    try {
      triggerExportDownload(input, result, activePresetId, { isDirty: isDirtyState });
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await readJsonFile(file);
      onImport(text);
    } catch (err) {
      console.error('File read error:', err);
    } finally {
      // 重置文件选择框，确保选取同一文件依然触发 onChange
      e.target.value = '';
    }
  };

  const showExport = mode === 'full' || mode === 'export-only';
  const showImport = mode === 'full' || mode === 'import-only';

  return (
    <div className={`import-export-controls ${className}`} role="group" aria-label="JSON 数据导入与导出">
      {showExport && (
        <button
          type="button"
          className="btn-outline"
          onClick={handleExport}
          disabled={isExportDisabled}
          tabIndex={isExportDisabled ? -1 : 0}
          aria-label={
            isDirtyState
              ? '输入已修改尚未重新计算，当前不可导出 (DIRTY)'
              : '导出当前分析配置为 JSON 文件'
          }
          title={
            isDirtyState
              ? '输入已修改，请先重新计算后再导出 (DIRTY 状态不可导出)'
              : isCalculatingState
                ? '正在计算中，请稍候...'
                : '导出 JSON 配置文件 (Export JSON)'
          }
          data-testid="export-json-button"
        >
          导出 JSON (Export)
        </button>
      )}

      {showImport && (
        <>
          <button
            type="button"
            className="btn-outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            tabIndex={0}
            aria-label="导入 JSON 配置文件"
            title="导入本地 JSON 配置文件 (Import JSON)"
            data-testid="import-json-button"
          >
            导入 JSON (Import)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
            aria-label="选择导入的 JSON 配置文件"
            data-testid="import-json-file-input"
          />
        </>
      )}
    </div>
  );
}

export default ImportExport;
