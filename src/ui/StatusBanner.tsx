/**
 * P009 时隙镜 TimeFold — 错误与状态横幅组件
 * 严格遵从 PROJECT_BOOK.md §4.3、§9 FR11 与 TASK-P009-T011。
 *
 * 核心要求：
 * 1. 状态指示：DIRTY / CALCULATING / READY / ERROR。
 * 2. 视觉三元组配文字图例：
 *    - 青绿 (#10b981): 被选有效时刻 (SELECTED)
 *    - 琥珀 (#f59e0b): 折返双候选 (FOLD)
 *    - 珊瑚 (#f43f5e): 缺失时刻 (GAP) / 固定间隔漂移 (DRIFT)
 *    - 严守规范：除颜色外同时给出 GAP / FOLD / DRIFT 文字、图例和解释，绝不以颜色为唯一判据。
 * 3. 错误提示：支持精确字段路径 (field path) 与错误代码展示。
 * 4. 辅助功能：采用 aria-live="polite" 和 role="status"。
 */

import React from 'react';

export type UiStatus = 'READY' | 'DIRTY' | 'CALCULATING' | 'ERROR';

export interface UiErrorDetail {
  code: string;
  path?: string | undefined;
  message: string;
}

export interface StatusBannerProps {
  status: UiStatus;
  statusMessage?: string | undefined;
  error?: UiErrorDetail | null | undefined;
  /** 可选的数值计数，体现除颜色外给出数值 */
  counts?: {
    requestCount?: number | undefined;
    selected?: number | undefined;
    fold?: number | undefined;
    gap?: number | undefined;
    drift?: number | undefined;
  } | undefined;
}

export function StatusBanner({
  status,
  statusMessage,
  error,
  counts,
}: StatusBannerProps): React.JSX.Element {
  // 根据状态确定徽章样式与主标题
  const getBadgeClass = (s: UiStatus): string => {
    switch (s) {
      case 'READY':
        return 'status-badge status-ready';
      case 'DIRTY':
        return 'status-badge status-dirty';
      case 'CALCULATING':
        return 'status-badge status-calculating';
      case 'ERROR':
        return 'status-badge status-error';
    }
  };

  const getDefaultMessage = (s: UiStatus): string => {
    switch (s) {
      case 'READY':
        return '当前状态已就绪，所有参数与计算结果一致。';
      case 'DIRTY':
        return '输入已更改，计算结果已过期，请点击“运行分析”更新。';
      case 'CALCULATING':
        return '后台 Worker 正在进行 2026 快照分钟级遍历分析...';
      case 'ERROR':
        return '输入或导入数据校验未通过，请检查错误提示修正。';
    }
  };

  const activeMessage = statusMessage || getDefaultMessage(status);

  return (
    <section
      className="status-banner-panel"
      role="status"
      aria-live="polite"
      aria-label="系统运行状态与图例"
    >
      {/* 左侧：运行状态指示 */}
      <div className="status-indicator-group">
        <span className={getBadgeClass(status)}>
          <span className="status-bullet" aria-hidden="true">●</span>
          <span>{status}</span>
        </span>
        <span className="status-text-explanation">{activeMessage}</span>
      </div>

      {/* 右侧：视觉图例区（青绿/琥珀/珊瑚三色，且同时配文字与数值） */}
      <div className="legend-group" aria-label="图例与状态标识说明">
        <div className="legend-item" title="青绿色：被选入最终日程的有效 UTC 实例">
          <span className="legend-swatch swatch-selected" aria-hidden="true" />
          <span className="legend-code code-selected">SELECTED</span>
          <span>
            有效实例
            {counts?.selected !== undefined
              ? counts?.requestCount !== undefined
                ? ` (选中 UTC 实例数: ${counts.selected}，请求日期数: ${counts.requestCount})`
                : ` (${counts.selected})`
              : ''}
          </span>
        </div>

        <div className="legend-item" title="琥珀色：秋季回拨产生的两个 UTC 候选（FOLD）">
          <span className="legend-swatch swatch-fold" aria-hidden="true" />
          <span className="legend-code code-fold">FOLD</span>
          <span>折返候选{counts?.fold !== undefined ? ` (${counts.fold})` : ''}</span>
        </div>

        <div className="legend-item" title="珊瑚色：春季跳时产生的无对应时刻（GAP）">
          <span className="legend-swatch swatch-gap" aria-hidden="true" />
          <span className="legend-code code-gap">GAP</span>
          <span>跳时缺口{counts?.gap !== undefined ? ` (${counts.gap})` : ''}</span>
        </div>

        <div className="legend-item" title="珊瑚色：固定真实间隔基线相对墙上时间的绝对漂移（DRIFT）">
          <span className="legend-swatch swatch-drift" aria-hidden="true" />
          <span className="legend-code code-drift">DRIFT</span>
          <span>基线漂移{counts?.drift !== undefined ? ` (${counts.drift})` : ''}</span>
        </div>
      </div>

      {/* 下方：错误详情区域（含字段路径） */}
      {status === 'ERROR' && error && (
        <div className="error-message-row" role="alert">
          <div className="error-title-line">
            <span>[错误拦截]</span>
            <span className="error-code-badge">{error.code}</span>
            {error.path && (
              <span className="error-path-tag">字段路径: {error.path}</span>
            )}
          </div>
          <div className="error-detail-text">{error.message}</div>
        </div>
      )}
    </section>
  );
}

export default StatusBanner;
