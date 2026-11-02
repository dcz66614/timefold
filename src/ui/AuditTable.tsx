/**
 * P009 时隙镜 TimeFold — 逐实例审计明细表 (AuditTable)
 *
 * 严格遵从 PROJECT_BOOK.md §4.2, §4.3, §5.3, §9 FR08, FR10, U08 与 IMPLEMENTATION_PLAN.md §5 T013、TASK-P009-T013。
 *
 * 核心特性：
 * 1. 逐实例映射明细展开：
 *    - 请求本地日/时间 (requestedLocal: YYYY-MM-DD HH:mm)。
 *    - 映射状态 (status: NORMAL / GAP / FOLD)，配备语义文字与色彩徽章。
 *    - 候选时刻集合 (candidatesUtc): 0/1/2 个 UTC 绝对时间 (YYYY-MM-DDTHH:mm:00Z)。
 *    - 策略裁决选中值 (selectedUtc): 被选中的 UTC 实例。
 *    - 基线对照时刻 (baselineUtc): 理论 24h 或 7×24h 固定间隔时刻 (once 模式为 N/A)。
 *    - 基线偏差 (driftMinutes): 整数分钟差异 (如 +60 min, 0 min, N/A)。
 * 2. 正常情况 (NONE) 绝无假风险警报，全平稳呈现。
 * 3. 交互与键盘无障碍可达：
 *    - 每行支持 tabIndex={0} 键盘聚焦、Enter/Space 选中。
 *    - 具备 role="table", role="row", role="cell" 等语义。
 *    - 点选行触发 onSelectIndex / onSelectRow 回调，提供与时间轴/见证卡的数据联动接口。
 * 4. 真实数据驱动：
 *    - 所有数据取自 AnalysisResult 或 AnalysisComputation，严禁硬编码。
 *    - 支持兼容带 digest 或无 digest 的计算对象。
 * 5. 限制文案与声明：
 *    - 标明仅供教学/开发测试，不适用于生产决策。
 *    - 标明 SYNTHETIC 合成标识与 frozen-2026 快照。
 */

import React from 'react';
import type {
  Mapping,
  AnalysisResult,
  AnalysisComputation,
  MappingStatus,
} from '../core/types';
import { formatDriftMinutes } from './WitnessPanel';

export interface AuditTableProps {
  /** 兼容完整分析结果对象（含或不含 digest） */
  result?: AnalysisResult | AnalysisComputation | null;
  /** 显式发生的逐日映射记录列表（若未传 result 可直接传 occurrences） */
  occurrences?: Mapping[];
  /** 当前选中的项索引 */
  selectedIndex?: number | null;
  /** 点击或按键选择发生项回调 (索引) */
  onSelectIndex?: (index: number) => void;
  /** 点击或按键选择发生项回调 (整行数据) */
  onSelectRow?: (index: number, row: Mapping) => void;
  /** 首个见证日期 (用于高亮首个见证行) */
  firstWitnessDate?: string | null;
  /** 额外可覆盖的 digest 摘要 */
  digest?: string | null;
  /** 自定义外层样式类名 */
  className?: string;
}

/** 状态徽章渲染器 */
function renderStatusBadge(status: MappingStatus): React.JSX.Element {
  switch (status) {
    case 'GAP':
      return (
        <span
          className="badge-tag"
          style={{
            backgroundColor: 'var(--color-coral-bg)',
            color: 'var(--color-coral)',
            borderColor: 'var(--color-coral-border)',
            padding: '0.15rem 0.4rem',
            fontSize: '0.7rem',
          }}
          data-testid="status-badge-gap"
        >
          GAP 缺失
        </span>
      );
    case 'FOLD':
      return (
        <span
          className="badge-tag"
          style={{
            backgroundColor: 'var(--color-amber-bg)',
            color: 'var(--color-amber)',
            borderColor: 'var(--color-amber-border)',
            padding: '0.15rem 0.4rem',
            fontSize: '0.7rem',
          }}
          data-testid="status-badge-fold"
        >
          FOLD 折返
        </span>
      );
    case 'NORMAL':
    default:
      return (
        <span
          className="badge-tag"
          style={{
            backgroundColor: 'var(--color-teal-bg)',
            color: 'var(--color-teal)',
            borderColor: 'var(--color-teal-border)',
            padding: '0.15rem 0.4rem',
            fontSize: '0.7rem',
          }}
          data-testid="status-badge-normal"
        >
          NORMAL 正常
        </span>
      );
  }
}

export function AuditTable({
  result,
  occurrences,
  selectedIndex,
  onSelectIndex,
  onSelectRow,
  firstWitnessDate,
  digest,
  className = '',
}: AuditTableProps): React.JSX.Element {
  // 1. 提取有效数据
  const effectiveOccurrences: Mapping[] =
    occurrences ?? result?.occurrences ?? [];
  const effectiveWitnessDate: string | null =
    firstWitnessDate ?? result?.firstWitness?.date ?? null;
  const effectiveWitnessType = result?.firstWitness?.type ?? null;
  const effectiveDigest: string | null =
    digest ??
    (result && 'digest' in result && typeof result.digest === 'string'
      ? result.digest
      : null);
  const requestCount =
    result?.requestCount ?? effectiveOccurrences.length;
  const selectedCount =
    result?.selectedCount ??
    effectiveOccurrences.reduce((acc, row) => acc + row.selectedUtc.length, 0);

  // 2. 行选择事件处理
  const handleRowClick = (idx: number, row: Mapping) => {
    if (onSelectIndex) {
      onSelectIndex(idx);
    }
    if (onSelectRow) {
      onSelectRow(idx, row);
    }
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTableRowElement>,
    idx: number,
    row: Mapping
  ) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleRowClick(idx, row);
    }
  };

  return (
    <footer
      className={`bottom-audit-panel audit-table-container ${className}`}
      role="region"
      aria-label="逐实例审计表"
      data-testid="audit-table-panel"
    >
      {/* 头部面板条 */}
      <div
        className="panel-header-title"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontWeight: 700 }}>底：逐实例映射审计表 (AuditTable)</span>
          <span className="badge-tag badge-snapshot">2026 FROZEN</span>
          <span className="badge-tag badge-synthetic">SYNTHETIC</span>
        </div>

        {/* 统计指标与 Digest 摘要 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
            fontSize: '0.75rem',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span style={{ color: 'var(--color-text-muted)' }}>
            请求数:{' '}
            <strong style={{ color: 'var(--color-text-main)' }} data-testid="audit-request-count">
              {requestCount}
            </strong>
          </span>
          <span style={{ color: 'var(--color-text-muted)' }}>
            选中实例:{' '}
            <strong style={{ color: 'var(--color-teal)' }} data-testid="audit-selected-count">
              {selectedCount}
            </strong>
          </span>
          <span style={{ color: 'var(--color-text-subtle)' }}>
            SHA-256:{' '}
            <code
              style={{
                color: effectiveDigest ? 'var(--color-sky)' : 'var(--color-text-subtle)',
              }}
              data-testid="audit-digest"
            >
              {effectiveDigest
                ? `${effectiveDigest.slice(0, 10)}...`
                : '纯计算 (待封包)'}
            </code>
          </span>
        </div>
      </div>

      {/* 空数据占位 */}
      {effectiveOccurrences.length === 0 ? (
        <div
          className="audit-placeholder-box"
          style={{ minHeight: '100px' }}
          data-testid="audit-empty-state"
        >
          <p className="placeholder-sub" style={{ margin: 0 }}>
            当前没有映射实例数据，请配置排程后运行分析。
          </p>
        </div>
      ) : (
        /* 真实审计表格容器 */
        <div
          style={{
            width: '100%',
            overflowX: 'auto',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-bg-card)',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: '0.775rem',
              fontFamily: 'var(--font-sans)',
            }}
            role="table"
            data-testid="audit-table"
          >
            <thead>
              <tr
                style={{
                  backgroundColor: 'var(--color-bg-elevated)',
                  borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.725rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                <th style={{ padding: '0.55rem 0.75rem', width: '40px' }}>#</th>
                <th style={{ padding: '0.55rem 0.75rem' }}>请求本地时间</th>
                <th style={{ padding: '0.55rem 0.75rem' }}>映射状态</th>
                <th style={{ padding: '0.55rem 0.75rem' }}>候选 UTC (0/1/2)</th>
                <th style={{ padding: '0.55rem 0.75rem' }}>选中 UTC 实例</th>
                <th style={{ padding: '0.55rem 0.75rem' }}>基线对照时刻</th>
                <th style={{ padding: '0.55rem 0.75rem' }}>基线偏差</th>
                <th style={{ padding: '0.55rem 0.75rem' }}>见证标记</th>
              </tr>
            </thead>
            <tbody>
              {effectiveOccurrences.map((row, index) => {
                const isSelected = selectedIndex === index;
                const rowDate = row.requestedLocal.slice(0, 10);
                const isFirstWitness =
                  effectiveWitnessType !== 'NONE' &&
                  effectiveWitnessDate !== null &&
                  rowDate === effectiveWitnessDate;

                // 确定行背景色
                let rowBg = 'transparent';
                if (isSelected) {
                  rowBg = 'rgba(56, 189, 248, 0.15)';
                } else if (isFirstWitness) {
                  rowBg =
                    row.status === 'FOLD'
                      ? 'rgba(245, 158, 11, 0.08)'
                      : 'rgba(244, 63, 94, 0.08)';
                } else if (index % 2 === 1) {
                  rowBg = 'rgba(255, 255, 255, 0.015)';
                }

                return (
                  <tr
                    key={`${row.requestedLocal}-${index}`}
                    tabIndex={0}
                    role="row"
                    aria-selected={isSelected}
                    onClick={() => handleRowClick(index, row)}
                    onKeyDown={(e) => handleKeyDown(e, index, row)}
                    className={`audit-row ${isSelected ? 'row-selected' : ''} ${
                      isFirstWitness ? 'row-witness' : ''
                    }`}
                    style={{
                      backgroundColor: rowBg,
                      borderBottom: '1px solid var(--color-border-subtle)',
                      cursor: 'pointer',
                      outline: isSelected ? '1px solid var(--color-sky)' : undefined,
                      transition: 'background-color 0.1s ease',
                    }}
                    data-testid={`audit-row-${index}`}
                    data-date={rowDate}
                  >
                    {/* 序号 */}
                    <td
                      style={{
                        padding: '0.5rem 0.75rem',
                        color: 'var(--color-text-subtle)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {index + 1}
                    </td>

                    {/* 请求本地时间 */}
                    <td
                      style={{
                        padding: '0.5rem 0.75rem',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        color: isSelected ? 'var(--color-sky)' : 'var(--color-text-main)',
                      }}
                      data-testid={`audit-requested-${index}`}
                    >
                      {row.requestedLocal}
                    </td>

                    {/* 状态 */}
                    <td
                      style={{ padding: '0.5rem 0.75rem' }}
                      data-testid={`audit-status-${index}`}
                    >
                      {renderStatusBadge(row.status)}
                    </td>

                    {/* 候选 UTC 集合 */}
                    <td
                      style={{
                        padding: '0.5rem 0.75rem',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.725rem',
                        color:
                          row.candidatesUtc.length === 0
                            ? 'var(--color-coral)'
                            : row.candidatesUtc.length === 2
                            ? 'var(--color-amber)'
                            : 'var(--color-text-muted)',
                      }}
                      data-testid={`audit-candidates-${index}`}
                    >
                      {row.candidatesUtc.length === 0 ? (
                        <span>0 候选 (跳时空洞)</span>
                      ) : (
                        <span>
                          [{row.candidatesUtc.length} 候选]: {row.candidatesUtc.join(', ')}
                        </span>
                      )}
                    </td>

                    {/* 决策选中时刻 */}
                    <td
                      style={{
                        padding: '0.5rem 0.75rem',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.725rem',
                        color:
                          row.selectedUtc.length > 0
                            ? 'var(--color-teal)'
                            : 'var(--color-text-subtle)',
                        fontWeight: row.selectedUtc.length > 0 ? 600 : 400,
                      }}
                      data-testid={`audit-selected-${index}`}
                    >
                      {row.selectedUtc.length > 0
                        ? row.selectedUtc.join(', ')
                        : '跳过 (无选中值)'}
                    </td>

                    {/* 基线时刻 */}
                    <td
                      style={{
                        padding: '0.5rem 0.75rem',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.725rem',
                        color: 'var(--color-text-muted)',
                      }}
                      data-testid={`audit-baseline-${index}`}
                    >
                      {row.baselineUtc || 'N/A'}
                    </td>

                    {/* 基线偏差 */}
                    <td
                      style={{
                        padding: '0.5rem 0.75rem',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        color:
                          row.driftMinutes && row.driftMinutes !== 0
                            ? 'var(--color-coral)'
                            : 'var(--color-text-muted)',
                      }}
                      data-testid={`audit-drift-${index}`}
                    >
                      {formatDriftMinutes(row.driftMinutes)}
                    </td>

                    {/* 首个见证标记 */}
                    <td
                      style={{ padding: '0.5rem 0.75rem' }}
                      data-testid={`audit-marker-${index}`}
                    >
                      {isFirstWitness && (
                        <span
                          className="badge-tag"
                          style={{
                            backgroundColor:
                              row.status === 'FOLD'
                                ? 'var(--color-amber-bg)'
                                : 'var(--color-coral-bg)',
                            color:
                              row.status === 'FOLD'
                                ? 'var(--color-amber)'
                                : 'var(--color-coral)',
                            border: `1px solid ${
                              row.status === 'FOLD'
                                ? 'var(--color-amber-border)'
                                : 'var(--color-coral-border)'
                            }`,
                            padding: '0.15rem 0.4rem',
                            fontSize: '0.675rem',
                          }}
                          data-testid="audit-first-witness-badge"
                        >
                          ★ 首个见证
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 限制文案与说明条（文案层严格遵守项目规范） */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          fontSize: '0.725rem',
          color: 'var(--color-text-subtle)',
          paddingTop: '0.5rem',
        }}
      >
        <span>
          <strong>说明：</strong> 本映射表由纯本地确定性时区求解器计算；数据
          <strong>仅供教学/开发测试排错，不适用于生产决策</strong>。
        </span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>
          MODE: FROZEN-2026 / SYNTHETIC / OFFLINE
        </span>
      </div>
    </footer>
  );
}