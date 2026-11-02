/**
 * P009 时隙镜 TimeFold — 双轨时间轴可视化组件 (TimeRail)
 *
 * 严格遵从 PROJECT_BOOK.md §4.3、§5.3 与 IMPLEMENTATION_PLAN.md §5 T012、TASK-P009-T012。
 *
 * 核心特性：
 * 1. 纯 SVG 绘图，完全由输入结果 (Mapping[]) 决定，绝不写死任何预设。
 * 2. 双轨结构：
 *    - 上轨：① 墙上固定轨 (Local Wall-Clock Rail)
 *    - 下轨：② UTC 间隔固定轨 (Fixed UTC Interval Rail)
 * 3. 三态反像映射可视化：
 *    - NORMAL (正常日)：单线与实心节点 (SELECTED #10b981)
 *    - GAP (跳时日)：空洞圆环与虚线 (GAP #f43f5e)
 *    - FOLD (折返日)：双分支弧线与双候选节点 (FOLD #f59e0b)
 * 4. 差异连线 (DRIFT)：
 *    - 呈现墙上时刻与固定 1440m 间隔对照的绝对差异 (DRIFT #f43f5e)
 *    - 显示整数分钟差 (如 +60 min, -60 min, 0 min, N/A)
 * 5. 全面可访问性：
 *    - 提供独立的 SELECTED / FOLD / GAP / DRIFT 图例与文字标签，绝不仅依赖颜色
 *    - 完整的时间刻度与 UTC / Local 明确标识
 *    - 支持键盘聚焦与选中交互 (tabIndex=0, role="button")
 */

import React from 'react';
import type { Mapping, AnalysisResult, AnalysisComputation } from '../core/types';

export interface TimeRailProps {
  /** 映射结果数组 (权威数据源) */
  occurrences?: Mapping[];
  /** 兼容别名 */
  mappings?: Mapping[];
  /** 兼容完整分析结果对象 (包括带/不带 digest 的分析汇总) */
  result?: AnalysisResult | AnalysisComputation | { occurrences: Mapping[] } | null;
  /** 当前选中的发生项索引 */
  selectedIndex?: number | null;
  /** 点击或键盘选中回调 */
  onSelectIndex?: (index: number) => void;
  /** 时区说明标签 (可选) */
  timeZoneLabel?: string;
  /** 自定义外层容器类名 */
  className?: string;
}

/** 格式化完整 UTC 时间 */
function formatUtc(utcStr: string | null | undefined): string {
  if (!utcStr) return 'N/A';
  return utcStr;
}

/** 格式化紧凑 UTC 展现：例如 2026-03-09T13:00:00Z -> 13:00Z */
function formatCompactUtc(utcStr: string | null | undefined): string {
  if (!utcStr) return 'N/A';
  const match = utcStr.match(/T(\d{2}:\d{2}):\d{2}Z/);
  return match ? `${match[1]}Z` : utcStr;
}

export function TimeRail(props: TimeRailProps): React.JSX.Element {
  const {
    occurrences,
    mappings,
    result,
    selectedIndex,
    onSelectIndex,
    timeZoneLabel,
    className,
  } = props;

  const rows: Mapping[] = occurrences ?? mappings ?? result?.occurrences ?? [];
  const rowCount = rows.length;

  // 空数据状态
  if (rowCount === 0) {
    return (
      <div
        className={`timerail-container ${className || ''}`}
        style={{ width: '100%', overflowX: 'auto' }}
        data-testid="timerail-container"
      >
        <svg
          viewBox="0 0 800 220"
          width="100%"
          height={220}
          role="img"
          aria-label="双轨时间轴暂无数据"
          data-testid="time-rail-svg"
          style={{
            background: 'var(--color-bg-card, #131d35)',
            borderRadius: '8px',
            display: 'block',
          }}
        >
          <text
            x="400"
            y="110"
            textAnchor="middle"
            fill="var(--color-text-muted, #94a3b8)"
            fontSize="14"
            fontFamily="var(--font-sans, sans-serif)"
          >
            暂无时间映射数据 (No occurrences data)
          </text>
        </svg>
      </div>
    );
  }

  // 布局尺寸计算
  const colWidth = rowCount <= 2 ? 320 : rowCount <= 4 ? 240 : rowCount <= 8 ? 190 : 150;
  const leftMargin = 180;
  const rightMargin = 80;
  const contentWidth = rowCount * colWidth;
  const svgWidth = Math.max(860, leftMargin + contentWidth + rightMargin);
  const svgHeight = 450;

  // 垂直核心基线
  const rail1Y = 160; // 墙上固定轨 (Local)
  const rail2Y = 320; // UTC 间隔固定轨 (UTC Baseline)
  const middleY = (rail1Y + rail2Y) / 2; // 240, 差异连线与漂移徽章中心

  // 辅助统计无障碍描述
  const gapCount = rows.filter((r) => r.status === 'GAP').length;
  const foldCount = rows.filter((r) => r.status === 'FOLD').length;
  const driftCount = rows.filter((r) => r.driftMinutes !== null && r.driftMinutes !== 0).length;

  return (
    <div
      className={`timerail-container ${className || ''}`}
      style={{
        width: '100%',
        overflowX: 'auto',
        background: 'var(--color-bg-card, #131d35)',
        borderRadius: '8px',
        padding: '8px 0',
      }}
      data-testid="timerail-container"
      role="region"
      aria-label="双轨时间轴可视化区域"
    >
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width={svgWidth}
        height={svgHeight}
        role="img"
        aria-label={`双轨时间轴：总请求 ${rowCount} 项，跳时缺口 ${gapCount}，折返候选 ${foldCount}，基线漂移 ${driftCount}`}
        data-testid="time-rail-svg"
        style={{
          display: 'block',
          fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
        }}
      >
        <title>双轨时间轴 (TimeRail)</title>
        <desc>
          {`共 ${rowCount} 项映射。包含跳时日空洞 (GAP: ${gapCount})、折返日双分支 (FOLD: ${foldCount}) 与固定间隔漂移连线 (DRIFT: ${driftCount})。`}
        </desc>

        {/* 顶部图例与标识栏 */}
        <g className="rail-legend" transform="translate(24, 28)">
          <text
            x={0}
            y={0}
            fill="var(--color-text-main, #f8fafc)"
            fontSize="14"
            fontWeight="bold"
          >
            双轨时间轴 (TimeRail)
          </text>
          {timeZoneLabel && (
            <text
              x={180}
              y={0}
              fill="var(--color-text-subtle, #64748b)"
              fontSize="12"
            >
              [{timeZoneLabel}]
            </text>
          )}

          {/* 图例项：SELECTED (青绿) */}
          <g transform="translate(320, -5)" data-testid="legend-selected">
            <circle cx={6} cy={5} r={5} fill="#10b981" />
            <text x={18} y={9} fill="var(--color-text-main, #f8fafc)" fontSize="11">
              <tspan fill="#10b981" fontWeight="bold">SELECTED</tspan> 有效实例
            </text>
          </g>

          {/* 图例项：FOLD (琥珀) */}
          <g transform="translate(450, -5)" data-testid="legend-fold">
            <path d="M 0 5 Q 6 0 12 5" fill="none" stroke="#f59e0b" strokeWidth={2.5} />
            <circle cx={12} cy={5} r={3.5} fill="#f59e0b" />
            <text x={20} y={9} fill="var(--color-text-main, #f8fafc)" fontSize="11">
              <tspan fill="#f59e0b" fontWeight="bold">FOLD</tspan> 折返双分支
            </text>
          </g>

          {/* 图例项：GAP (珊瑚) */}
          <g transform="translate(585, -5)" data-testid="legend-gap">
            <circle cx={6} cy={5} r={5} fill="none" stroke="#f43f5e" strokeWidth={2} strokeDasharray="2 2" />
            <text x={18} y={9} fill="var(--color-text-main, #f8fafc)" fontSize="11">
              <tspan fill="#f43f5e" fontWeight="bold">GAP</tspan> 跳时空洞虚线
            </text>
          </g>

          {/* 图例项：DRIFT (珊瑚连线) */}
          <g transform="translate(735, -5)" data-testid="legend-drift">
            <line x1={0} y1={5} x2={14} y2={5} stroke="#f43f5e" strokeWidth={2} strokeDasharray="3 2" />
            <text x={20} y={9} fill="var(--color-text-main, #f8fafc)" fontSize="11">
              <tspan fill="#f43f5e" fontWeight="bold">DRIFT</tspan> 间隔漂移连线
            </text>
          </g>
        </g>

        {/* 轨道背景横线与左侧轨头 */}
        {/* ① 墙上固定轨 (Local Rail) */}
        <g className="rail-track-group rail-local-group">
          <line
            x1={leftMargin - 20}
            y1={rail1Y}
            x2={svgWidth - 30}
            y2={rail1Y}
            stroke="var(--color-border, #223458)"
            strokeWidth={2.5}
          />
          <g className="rail-header" transform={`translate(24, ${rail1Y})`}>
            <rect x={-4} y={-24} width={136} height={48} rx={4} fill="rgba(16, 185, 129, 0.08)" stroke="#10b981" strokeWidth={1} strokeOpacity={0.3} />
            <text x={6} y={-6} fill="var(--color-text-main, #f8fafc)" fontSize="12" fontWeight="bold">
              ① 墙上固定轨
            </text>
            <text x={6} y={12} fill="#10b981" fontSize="11" fontWeight="600">
              Local (当地时间)
            </text>
          </g>
        </g>

        {/* ② UTC 间隔固定轨 (UTC Rail) */}
        <g className="rail-track-group rail-utc-group">
          <line
            x1={leftMargin - 20}
            y1={rail2Y}
            x2={svgWidth - 30}
            y2={rail2Y}
            stroke="var(--color-border, #223458)"
            strokeWidth={2.5}
          />
          <g className="rail-header" transform={`translate(24, ${rail2Y})`}>
            <rect x={-4} y={-24} width={136} height={48} rx={4} fill="rgba(56, 189, 248, 0.08)" stroke="#38bdf8" strokeWidth={1} strokeOpacity={0.3} />
            <text x={6} y={-6} fill="var(--color-text-main, #f8fafc)" fontSize="12" fontWeight="bold">
              ② UTC 间隔固定轨
            </text>
            <text x={6} y={12} fill="#38bdf8" fontSize="11" fontWeight="600">
              UTC (绝对时间)
            </text>
          </g>
        </g>

        {/* 逐列渲染映射项 */}
        {rows.map((occ, i) => {
          const colX = leftMargin + i * colWidth + colWidth / 2;
          const isSelected = selectedIndex === i;

          // 本地时间拆分
          const [datePart = '', timePart = ''] = occ.requestedLocal.split(' ');

          return (
            <g
              key={`occ-col-${occ.requestedLocal}-${i}`}
              className={`timerail-column ${isSelected ? 'selected' : ''}`}
              data-testid="timerail-column"
              transform={`translate(0, 0)`}
            >
              {/* 列背景高亮交互层 */}
              <rect
                x={colX - colWidth / 2 + 6}
                y={60}
                width={colWidth - 12}
                height={svgHeight - 75}
                rx={6}
                fill={isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.015)'}
                stroke={isSelected ? '#38bdf8' : 'rgba(34, 52, 88, 0.4)'}
                strokeWidth={isSelected ? 1.5 : 1}
                tabIndex={0}
                role="button"
                aria-label={`时间点 ${i + 1}: 当地 ${occ.requestedLocal}, 状态 ${occ.status}, 基线偏差 ${
                  occ.driftMinutes !== null ? `${occ.driftMinutes > 0 ? `+${occ.driftMinutes}` : occ.driftMinutes} min` : 'N/A'
                }`}
                onClick={() => onSelectIndex?.(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectIndex?.(i);
                  }
                }}
                style={{ cursor: onSelectIndex ? 'pointer' : 'default' }}
              />

              {/* 列顶部日期刻度标签 */}
              <g className="column-header" transform={`translate(${colX}, 80)`}>
                <text
                  x={0}
                  y={0}
                  textAnchor="middle"
                  fill="var(--color-text-main, #f8fafc)"
                  fontSize="12"
                  fontWeight="bold"
                >
                  {`#${i + 1} ${datePart}`}
                </text>
                <text
                  x={0}
                  y={18}
                  textAnchor="middle"
                  fill="var(--color-text-muted, #94a3b8)"
                  fontSize="11"
                >
                  {`计划: ${timePart}`}
                </text>
              </g>

              {/* 轨 ① 刻度线 */}
              <line
                x1={colX}
                y1={rail1Y - 8}
                x2={colX}
                y2={rail1Y + 8}
                stroke="#64748b"
                strokeWidth={1.5}
                className="axis-tick-local"
              />

              {/* 轨 ② 刻度线 */}
              <line
                x1={colX}
                y1={rail2Y - 8}
                x2={colX}
                y2={rail2Y + 8}
                stroke="#64748b"
                strokeWidth={1.5}
                className="axis-tick-utc"
              />

              {/* =======================
                  轨道 ① 状态渲染 (Local)
                  ======================= */}
              {/* Case A: GAP 跳时日 */}
              {occ.status === 'GAP' && (
                <g className="rail-gap-group" data-testid="gap-group">
                  {/* 跳时空洞虚线穿透 */}
                  <line
                    x1={colX}
                    y1={rail1Y - 26}
                    x2={colX}
                    y2={rail1Y + 26}
                    stroke="#f43f5e"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    data-testid="gap-dashed-line"
                    className="rail-gap-dashed-line"
                  />
                  {/* 跳时空洞 */}
                  <circle
                    cx={colX}
                    cy={rail1Y}
                    r={9}
                    fill="var(--color-bg-card, #131d35)"
                    stroke="#f43f5e"
                    strokeWidth={2.5}
                    strokeDasharray="3 3"
                    data-testid="gap-hole"
                    className="rail-gap-hole"
                    aria-label="跳时空洞 (GAP)"
                  />
                  {/* GAP 语义徽章 */}
                  <g data-testid="gap-badge" className="rail-gap-badge" transform={`translate(${colX}, ${rail1Y - 42})`}>
                    <rect x={-24} y={-10} width={48} height={20} rx={4} fill="#f43f5e" />
                    <text x={0} y={4} textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="bold">
                      GAP
                    </text>
                  </g>
                  {/* 跳时说明文字 */}
                  <text x={colX} y={rail1Y + 26} textAnchor="middle" fill="#f43f5e" fontSize="10">
                    跳时缺失时刻 (0 候选)
                  </text>
                  {occ.realizedLocal.length > 0 ? (
                    <text x={colX} y={rail1Y + 40} textAnchor="middle" fill="#f59e0b" fontSize="10">
                      顺移至: {occ.realizedLocal[0]}
                    </text>
                  ) : (
                    <text x={colX} y={rail1Y + 40} textAnchor="middle" fill="var(--color-text-subtle, #64748b)" fontSize="10">
                      策略: 跳过 (skip)
                    </text>
                  )}
                </g>
              )}

              {/* Case B: FOLD 折返日 */}
              {occ.status === 'FOLD' && (
                <g className="rail-fold-group" data-testid="fold-group">
                  {/* 墙上中心基准节点 */}
                  <circle
                    cx={colX}
                    cy={rail1Y}
                    r={5}
                    fill="#f59e0b"
                    stroke="var(--color-bg-card, #131d35)"
                    strokeWidth={2}
                  />

                  {/* 双分支弧线：Branch 1 (较早 UTC 候选) */}
                  <path
                    d={`M ${colX} ${rail1Y} C ${colX - 18} ${rail1Y - 18}, ${colX - 32} ${rail1Y - 26}, ${colX - 44} ${rail1Y - 26}`}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    data-testid="fold-branch"
                    className="rail-fold-branch fold-branch-earlier"
                  />
                  {/* Branch 1 候选节点 */}
                  <circle
                    cx={colX - 44}
                    cy={rail1Y - 26}
                    r={5}
                    fill={occ.selectedUtc.includes(occ.candidatesUtc[0] || '') ? '#10b981' : '#f59e0b'}
                    stroke="var(--color-bg-card, #131d35)"
                    strokeWidth={1.5}
                    data-testid="fold-candidate-1"
                  />
                  <text
                    x={colX - 52}
                    y={rail1Y - 23}
                    textAnchor="end"
                    fill="var(--color-text-main, #f8fafc)"
                    fontSize="10"
                    fontWeight="500"
                  >
                    {formatCompactUtc(occ.candidatesUtc[0])}
                  </text>

                  {/* 双分支弧线：Branch 2 (较晚 UTC 候选) */}
                  <path
                    d={`M ${colX} ${rail1Y} C ${colX + 18} ${rail1Y + 18}, ${colX + 32} ${rail1Y + 26}, ${colX + 44} ${rail1Y + 26}`}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    data-testid="fold-branch"
                    className="rail-fold-branch fold-branch-later"
                  />
                  {/* Branch 2 候选节点 */}
                  <circle
                    cx={colX + 44}
                    cy={rail1Y + 26}
                    r={5}
                    fill={occ.selectedUtc.includes(occ.candidatesUtc[1] || '') ? '#10b981' : '#f59e0b'}
                    stroke="var(--color-bg-card, #131d35)"
                    strokeWidth={1.5}
                    data-testid="fold-candidate-2"
                  />
                  <text
                    x={colX + 52}
                    y={rail1Y + 29}
                    textAnchor="start"
                    fill="var(--color-text-main, #f8fafc)"
                    fontSize="10"
                    fontWeight="500"
                  >
                    {formatCompactUtc(occ.candidatesUtc[1])}
                  </text>

                  {/* FOLD 语义徽章 */}
                  <g data-testid="fold-badge" className="rail-fold-badge" transform={`translate(${colX}, ${rail1Y - 45})`}>
                    <rect x={-26} y={-10} width={52} height={20} rx={4} fill="#f59e0b" />
                    <text x={0} y={4} textAnchor="middle" fill="#060b19" fontSize="11" fontWeight="bold">
                      FOLD
                    </text>
                  </g>
                  {/* 折返说明文字 */}
                  <text x={colX} y={rail1Y + 48} textAnchor="middle" fill="#f59e0b" fontSize="10">
                    双分支折返 ({occ.selectedUtc.length}/2 选中)
                  </text>
                </g>
              )}

              {/* Case C: NORMAL 正常日 */}
              {occ.status === 'NORMAL' && (
                <g className="rail-normal-group" data-testid="normal-group">
                  {/* 正常日单线指示 */}
                  <line
                    x1={colX}
                    y1={rail1Y - 14}
                    x2={colX}
                    y2={rail1Y + 14}
                    stroke="#10b981"
                    strokeWidth={2.5}
                    data-testid="normal-line"
                    className="rail-normal-line"
                  />
                  {/* 正常日单节点 */}
                  <circle
                    cx={colX}
                    cy={rail1Y}
                    r={6}
                    fill="#10b981"
                    stroke="var(--color-bg-card, #131d35)"
                    strokeWidth={2}
                    data-testid="normal-node"
                    className="rail-normal-node"
                  />
                  {/* 单候选 UTC 时间标签 */}
                  <text
                    x={colX}
                    y={rail1Y - 22}
                    textAnchor="middle"
                    fill="#10b981"
                    fontSize="11"
                    fontWeight="bold"
                  >
                    {formatCompactUtc(occ.selectedUtc[0] || occ.candidatesUtc[0])}
                  </text>
                  {/* SELECTED 语义徽章 */}
                  <g data-testid="normal-badge" className="rail-normal-badge" transform={`translate(${colX}, ${rail1Y - 42})`}>
                    <rect
                      x={-34}
                      y={-9}
                      width={68}
                      height={18}
                      rx={4}
                      fill="rgba(16, 185, 129, 0.2)"
                      stroke="#10b981"
                      strokeWidth={1}
                    />
                    <text x={0} y={4} textAnchor="middle" fill="#10b981" fontSize="10" fontWeight="bold">
                      SELECTED
                    </text>
                  </g>
                </g>
              )}

              {/* ========================================================
                  中间层：双轨差异连线与漂移徽章 (Drift Divergence Line)
                  ======================================================== */}
              {occ.driftMinutes !== null ? (
                occ.driftMinutes !== 0 ? (
                  // 存在绝对漂移偏差 (DRIFT 分歧线)
                  <g className="rail-drift-group" data-testid="drift-group">
                    <line
                      x1={colX}
                      y1={rail1Y + 18}
                      x2={colX}
                      y2={rail2Y - 18}
                      stroke="#f43f5e"
                      strokeWidth={2.5}
                      strokeDasharray="5 3"
                      data-testid="drift-line"
                      className="rail-drift-line"
                    />
                    <g
                      data-testid="drift-badge"
                      className="rail-drift-badge"
                      transform={`translate(${colX}, ${middleY})`}
                    >
                      <rect x={-46} y={-11} width={92} height={22} rx={4} fill="#f43f5e" />
                      <text x={0} y={4} textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="bold">
                        {`DRIFT ${occ.driftMinutes > 0 ? `+${occ.driftMinutes}` : occ.driftMinutes} min`}
                      </text>
                    </g>
                  </g>
                ) : (
                  // 无漂移偏差 (0 min 吻合)
                  <g className="rail-match-group" data-testid="match-group">
                    <line
                      x1={colX}
                      y1={rail1Y + 18}
                      x2={colX}
                      y2={rail2Y - 18}
                      stroke="var(--color-border, #223458)"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      data-testid="match-line"
                      className="rail-match-line"
                    />
                    <rect
                      x={colX - 32}
                      y={middleY - 9}
                      width={64}
                      height={18}
                      rx={3}
                      fill="var(--color-bg-surface, #0d1527)"
                      stroke="var(--color-border, #223458)"
                      strokeWidth={1}
                    />
                    <text x={colX} y={middleY + 4} textAnchor="middle" fill="var(--color-text-muted, #94a3b8)" fontSize="10">
                      0 min 偏差
                    </text>
                  </g>
                )
              ) : (
                // 基线不可用 (如 once 计划)
                <g className="rail-na-drift-group">
                  <text x={colX} y={middleY + 4} textAnchor="middle" fill="var(--color-text-subtle, #64748b)" fontSize="10">
                    基线 N/A
                  </text>
                </g>
              )}

              {/* =======================
                  轨道 ② 状态渲染 (UTC)
                  ======================= */}
              {occ.baselineUtc !== null ? (
                <g className="rail-baseline-group" data-testid="baseline-group">
                  {/* 基准节点 */}
                  <circle
                    cx={colX}
                    cy={rail2Y}
                    r={6}
                    fill="#38bdf8"
                    stroke="var(--color-bg-card, #131d35)"
                    strokeWidth={2}
                    data-testid="baseline-node"
                    className="rail-baseline-node"
                  />
                  {/* 基准 UTC 时间标签 */}
                  <text
                    x={colX}
                    y={rail2Y + 22}
                    textAnchor="middle"
                    fill="#38bdf8"
                    fontSize="11"
                    fontWeight="bold"
                  >
                    {`UTC: ${formatCompactUtc(occ.baselineUtc)}`}
                  </text>
                  <text
                    x={colX}
                    y={rail2Y + 36}
                    textAnchor="middle"
                    fill="var(--color-text-muted, #94a3b8)"
                    fontSize="10"
                  >
                    固定基准 (1440m 步进)
                  </text>
                </g>
              ) : (
                <g className="rail-baseline-na-group">
                  <text
                    x={colX}
                    y={rail2Y + 6}
                    textAnchor="middle"
                    fill="var(--color-text-subtle, #64748b)"
                    fontSize="12"
                    fontWeight="bold"
                    data-testid="baseline-na"
                  >
                    N/A
                  </text>
                  <text
                    x={colX}
                    y={rail2Y + 22}
                    textAnchor="middle"
                    fill="var(--color-text-subtle, #64748b)"
                    fontSize="10"
                  >
                    单次计划无基准
                  </text>
                </g>
              )}

              {/* ====================================
                  底部数值与绝对 ISO 时间完整标注 (§4.3)
                  ==================================== */}
              <g className="column-numerical-values" transform={`translate(${colX}, 395)`}>
                <line
                  x1={-colWidth / 2 + 12}
                  y1={-12}
                  x2={colWidth / 2 - 12}
                  y2={-12}
                  stroke="var(--color-border-subtle, #18253e)"
                  strokeWidth={1}
                />
                <text
                  x={0}
                  y={4}
                  textAnchor="middle"
                  fill="var(--color-text-main, #f8fafc)"
                  fontSize="10"
                  fontFamily="var(--font-mono, monospace)"
                >
                  {`Local: ${occ.requestedLocal}`}
                </text>
                <text
                  x={0}
                  y={18}
                  textAnchor="middle"
                  fill="var(--color-text-muted, #94a3b8)"
                  fontSize="10"
                  fontFamily="var(--font-mono, monospace)"
                >
                  {occ.selectedUtc[0]
                    ? `UTC: ${formatUtc(occ.selectedUtc[0])}`
                    : occ.status === 'GAP'
                    ? 'UTC: (无 / 跳时)'
                    : `UTC: ${formatUtc(occ.candidatesUtc[0])}`}
                </text>
                <text
                  x={0}
                  y={32}
                  textAnchor="middle"
                  fill={
                    occ.driftMinutes !== null && occ.driftMinutes !== 0
                      ? '#f43f5e'
                      : 'var(--color-text-subtle, #64748b)'
                  }
                  fontSize="10"
                  fontWeight="600"
                >
                  {`差异: ${
                    occ.driftMinutes !== null
                      ? `${occ.driftMinutes > 0 ? `+${occ.driftMinutes}` : occ.driftMinutes} min`
                      : 'N/A'
                  }`}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default TimeRail;
