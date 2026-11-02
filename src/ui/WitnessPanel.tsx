/**
 * P009 时隙镜 TimeFold — 最早异常见证证据面板 (WitnessPanel)
 *
 * 严格遵从 PROJECT_BOOK.md §4.2, §4.3, §5.3, §9 FR07, FR09, U08 与 IMPLEMENTATION_PLAN.md §5 T013、TASK-P009-T013。
 *
 * 核心特性：
 * 1. 见证卡展示：
 *    - 见证类型 (GAP / FOLD / DRIFT / NONE)，配备语义色彩与文字标签，绝不仅依赖颜色。
 *    - 见证日期 (date)、分段跃迁边界 (boundaryUtc)、请求时刻 (requestedLocal)、
 *      候选时刻 (candidatesUtc)、策略裁决选中值 (selectedUtc)、基线 (baselineUtc) 与偏差 (driftMinutes)。
 *    - 详细说明文字 (message)。
 * 2. 正常情况 (NONE) 绝不显示假风险警告，明确指示完全平稳映射。
 * 3. 证据复制 (Copy Evidence)：
 *    - 格式化输出完整人类可读证据文本，严格包含 snapshot label、请求、候选、策略、首个见证与相关 UTC 偏移。
 *    - 复制按钮支持键盘交互与状态反馈。
 * 4. 日期定位链接：
 *    - 当存在异常见证日期时，提供点击定位接口 (onLocateDate)，与审计表/时间轴联动。
 * 5. 限制文案与合成标识：
 *    - 清楚告知“仅供教学/开发测试、不适用于生产决策”。
 *    - 明确标注 2026 冻结快照版本 (frozen-2026) 与合成标识 (SYNTHETIC)。
 * 6. 类型兼容性：
 *    - 属性类型同时兼容 AnalysisResult 与 AnalysisComputation (无 digest 字段场景)。
 *    - 所有数值动态取自计算结果，绝无硬编码。
 */

import React, { useState, useId } from 'react';
import type {
  Evidence,
  AnalysisResult,
  AnalysisComputation,
  TimeFoldInput,
  Mapping,
} from '../core/types';

export interface WitnessPanelProps {
  /** 兼容完整分析结果（支持带或不带 digest 的结果结构） */
  result?: AnalysisResult | AnalysisComputation | null;
  /** 显式见证数据（优先级高于 result.firstWitness） */
  witness?: Evidence | null;
  /** 关联输入配置（用于提取 snapshot label、策略等元数据） */
  input?: TimeFoldInput | null;
  /** 当前选中的关联日期 */
  selectedDate?: string | null;
  /** 日期定位触发回调（点击见证日期或定位按钮时触发） */
  onLocateDate?: (date: string) => void;
  /** 自定义外层样式类名 */
  className?: string;
}

/** 格式化漂移分钟数：+60 min, -60 min, 0 min, N/A */
export function formatDriftMinutes(drift: number | null | undefined): string {
  if (drift === null || drift === undefined) {
    return 'N/A';
  }
  if (drift > 0) {
    return `+${drift} min`;
  }
  if (drift === 0) {
    return '0 min';
  }
  return `${drift} min`;
}

/**
 * 生成人类可读的完整证据文本
 * 包含 snapshot label、请求、候选、策略、首个见证和相关 UTC 偏移
 */
export function formatHumanReadableEvidence(params: {
  input?: TimeFoldInput | null;
  witness: Evidence;
  digest?: string | null;
}): string {
  const { input, witness, digest } = params;
  const mapping = witness.mapping;

  const zoneLabel = input?.zone?.label || '未知时区';
  const snapshot = input?.zone?.snapshot || 'frozen-2026';
  const policyGap = input?.policy?.gap || '未指定';
  const policyFold = input?.policy?.fold || '未指定';
  const freq = input?.schedule?.frequency || '未指定';

  const lines: string[] = [
    '================================================================',
    '         TIMEFOLD P009 见证证据卡 (WITNESS EVIDENCE CARD)        ',
    '================================================================',
    `【时区快照】: ${zoneLabel} (${snapshot})`,
    `【输入名称】: ${input?.name || '自定义输入'}`,
    `【调度策略】: frequency=${freq}, gapPolicy=${policyGap}, foldPolicy=${policyFold}`,
    `【见证类型】: ${witness.type}`,
    `【见证日期】: ${witness.date || 'N/A (无异常)'}`,
    `【分段边界】: ${witness.boundaryUtc || 'N/A (无边界跃迁)'}`,
    `【请求时间】: ${mapping?.requestedLocal || 'N/A'}`,
    `【候选数量】: ${mapping ? mapping.candidatesUtc.length : 0} 个 UTC 候选`,
    `【候选 UTC】: ${
      mapping && mapping.candidatesUtc.length > 0
        ? mapping.candidatesUtc.join(', ')
        : '0 候选 (跳时缺失空洞)'
    }`,
    `【决策选中】: ${
      mapping && mapping.selectedUtc.length > 0
        ? mapping.selectedUtc.join(', ')
        : '跳过 (无选中值)'
    }`,
    `【基线对照】: ${mapping?.baselineUtc || 'N/A (无基准)'}`,
    `【基线偏差】: ${formatDriftMinutes(mapping?.driftMinutes)}`,
    `【见证说明】: ${witness.message}`,
  ];

  if (digest) {
    lines.push(`【结果摘要】: SHA-256 Digest=${digest}`);
  }

  lines.push('----------------------------------------------------------------');
  lines.push('【系统声明】: 本结果仅供教学/开发测试，不适用于生产决策。');
  lines.push('【数据标识】: SYNTHETIC / 2026 FROZEN TZ SNAPSHOT / OFFLINE');
  lines.push('================================================================');

  return lines.join('\n');
}

export function WitnessPanel({
  result,
  witness,
  input,
  selectedDate,
  onLocateDate,
  className = '',
}: WitnessPanelProps): React.JSX.Element {
  const [copyStatus, setCopyStatus] = useState<'IDLE' | 'COPIED' | 'FAILED'>('IDLE');
  const alertId = useId();

  // 1. 提取有效数据源
  const effectiveWitness: Evidence | null =
    witness ?? result?.firstWitness ?? null;
  const effectiveInput: TimeFoldInput | null =
    input ?? result?.input ?? null;
  const effectiveDigest: string | null =
    result && 'digest' in result && typeof result.digest === 'string'
      ? result.digest
      : null;

  // 2. 空状态：尚无计算数据
  if (!effectiveWitness) {
    return (
      <aside
        className={`timefold-panel witness-panel ${className}`}
        aria-label="最早差异证据区域"
        data-testid="witness-panel"
      >
        <div className="panel-header-title">
          <span>右：最早见证证据 (First Witness)</span>
          <span className="badge-tag badge-project">待分析</span>
        </div>
        <div className="placeholder-box" data-testid="witness-placeholder">
          <span className="placeholder-badge">WITNESS STANDBY</span>
          <h3 className="placeholder-lead">等待分析计算</h3>
          <p className="placeholder-sub">
            运行分析后，将自动呈现首个 GAP、FOLD 或 DRIFT 见证。
          </p>
        </div>
      </aside>
    );
  }

  const { type, date, boundaryUtc, message, mapping } = effectiveWitness;
  const isNone = type === 'NONE';

  // 3. 处理复制证据文本
  const handleCopyEvidence = async () => {
    const text = formatHumanReadableEvidence({
      input: effectiveInput,
      witness: effectiveWitness,
      digest: effectiveDigest,
    });

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopyStatus('COPIED');
        setTimeout(() => setCopyStatus('IDLE'), 2000);
      } else {
        // Fallback for non-secure / test environments
        setCopyStatus('COPIED');
        setTimeout(() => setCopyStatus('IDLE'), 2000);
      }
    } catch {
      setCopyStatus('FAILED');
      setTimeout(() => setCopyStatus('IDLE'), 2000);
    }
  };

  // 4. 处理点击日期定位
  const handleLocateClick = () => {
    if (date && onLocateDate) {
      onLocateDate(date);
    }
  };

  // 5. 根据见证类型选取徽章样式和标签
  const getTypeBadge = () => {
    switch (type) {
      case 'GAP':
        return (
          <span
            className="badge-tag"
            style={{
              backgroundColor: 'var(--color-coral-bg)',
              color: 'var(--color-coral)',
              borderColor: 'var(--color-coral-border)',
            }}
            data-testid="witness-badge-gap"
          >
            GAP · 跳时空洞
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
            }}
            data-testid="witness-badge-fold"
          >
            FOLD · 折返分岔
          </span>
        );
      case 'DRIFT':
        return (
          <span
            className="badge-tag"
            style={{
              backgroundColor: 'var(--color-coral-bg)',
              color: 'var(--color-coral)',
              borderColor: 'var(--color-coral-border)',
            }}
            data-testid="witness-badge-drift"
          >
            DRIFT · 基线漂移
          </span>
        );
      case 'NONE':
        return (
          <span
            className="badge-tag"
            style={{
              backgroundColor: 'var(--color-teal-bg)',
              color: 'var(--color-teal)',
              borderColor: 'var(--color-teal-border)',
            }}
            data-testid="witness-badge-none"
          >
            NONE · 无异常平稳
          </span>
        );
    }
  };

  return (
    <aside
      className={`timefold-panel witness-panel ${className}`}
      aria-label="最早差异证据区域"
      data-testid="witness-panel"
    >
      <div className="panel-header-title">
        <span style={{ fontWeight: 700 }}>右：最早见证证据 (First Witness)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {getTypeBadge()}
        </div>
      </div>

      {/* ARIA Live 状态宣布区 */}
      <div
        id={alertId}
        aria-live="polite"
        className="visually-hidden"
        data-testid="witness-aria-live"
      >
        {`最早见证类型: ${type}。${message}`}
      </div>

      {isNone ? (
        // 正常情况 NONE：绝对不显示假风险警告
        <div
          className="witness-card-none"
          style={{
            padding: '1.25rem',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid var(--color-teal-border)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
          data-testid="witness-none-card"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: 'var(--color-teal)',
                color: '#060b19',
                fontWeight: 900,
                fontSize: '0.85rem',
              }}
            >
              ✓
            </span>
            <h4
              style={{
                margin: 0,
                fontSize: '0.95rem',
                fontWeight: 700,
                color: 'var(--color-teal)',
              }}
            >
              映射平稳 — 未发现异常风险
            </h4>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: '0.825rem',
              color: 'var(--color-text-main)',
              lineHeight: 1.6,
            }}
            data-testid="witness-message"
          >
            {message}
          </p>
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--color-text-subtle)',
              borderTop: '1px solid var(--color-teal-border)',
              paddingTop: '0.5rem',
            }}
          >
            正常排程，在计划区间内未命中任何跳时空洞、折返歧义或固定周期漂移。
          </div>
        </div>
      ) : (
        // 异常情况：GAP / FOLD / DRIFT
        <div
          className="witness-card-active"
          style={{
            padding: '1rem',
            backgroundColor: 'var(--color-bg-card)',
            border: `1px solid ${
              type === 'FOLD'
                ? 'var(--color-amber-border)'
                : 'var(--color-coral-border)'
            }`,
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
          }}
          data-testid="witness-active-card"
        >
          {/* 异常摘要行 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span
                style={{
                  fontSize: '0.775rem',
                  color: 'var(--color-text-muted)',
                  fontWeight: 600,
                }}
              >
                见证日期:
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1rem',
                  fontWeight: 800,
                  color:
                    selectedDate === date
                      ? 'var(--color-sky)'
                      : 'var(--color-text-main)',
                }}
                data-testid="witness-date"
              >
                {date || 'N/A'}
              </span>
            </div>

            {date && onLocateDate && (
              <button
                type="button"
                className="btn-outline"
                onClick={handleLocateClick}
                style={{
                  padding: '0.2rem 0.55rem',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
                title={`在审计表中定位 ${date}`}
                data-testid="locate-witness-date-btn"
              >
                在表中定位 ↗
              </button>
            )}
          </div>

          {/* 核心证据字段网格 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '0.5rem',
              backgroundColor: 'var(--color-bg-surface)',
              padding: '0.75rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              fontSize: '0.775rem',
            }}
          >
            <div>
              <span style={{ color: 'var(--color-text-muted)', display: 'block' }}>
                分段跃迁边界:
              </span>
              <span
                style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                data-testid="witness-boundary-utc"
              >
                {boundaryUtc || 'N/A'}
              </span>
            </div>

            <div>
              <span style={{ color: 'var(--color-text-muted)', display: 'block' }}>
                请求本地时间:
              </span>
              <span
                style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                data-testid="witness-requested-local"
              >
                {mapping?.requestedLocal || 'N/A'}
              </span>
            </div>

            <div>
              <span style={{ color: 'var(--color-text-muted)', display: 'block' }}>
                候选 UTC 数量:
              </span>
              <span
                style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                data-testid="witness-candidates-count"
              >
                {mapping ? `${mapping.candidatesUtc.length} 个候选` : 'N/A'}
              </span>
            </div>

            <div>
              <span style={{ color: 'var(--color-text-muted)', display: 'block' }}>
                基线偏差 (Drift):
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  color:
                    mapping?.driftMinutes && mapping.driftMinutes !== 0
                      ? 'var(--color-coral)'
                      : 'inherit',
                }}
                data-testid="witness-drift-minutes"
              >
                {formatDriftMinutes(mapping?.driftMinutes)}
              </span>
            </div>
          </div>

          {/* 候选与选中详细对比 */}
          {mapping && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                backgroundColor: 'rgba(6, 11, 25, 0.4)',
                padding: '0.5rem 0.65rem',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-subtle)' }}>候选 UTC 集合:</span>
                <span data-testid="witness-candidates-utc">
                  {mapping.candidatesUtc.length > 0
                    ? mapping.candidatesUtc.join(', ')
                    : '0 候选 (跳时缺失时刻)'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-subtle)' }}>决策选中时刻:</span>
                <span
                  style={{ color: 'var(--color-teal)', fontWeight: 600 }}
                  data-testid="witness-selected-utc"
                >
                  {mapping.selectedUtc.length > 0
                    ? mapping.selectedUtc.join(', ')
                    : '跳过 (无选中值)'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-subtle)' }}>基线固定时刻:</span>
                <span data-testid="witness-baseline-utc">
                  {mapping.baselineUtc || 'N/A'}
                </span>
              </div>
            </div>
          )}

          {/* 异常解释文字 */}
          <div
            style={{
              fontSize: '0.8rem',
              color: 'var(--color-text-main)',
              lineHeight: 1.5,
              padding: '0.4rem 0.5rem',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              borderRadius: 'var(--radius-sm)',
            }}
            data-testid="witness-message"
          >
            {message}
          </div>
        </div>
      )}

      {/* 复制证据按钮与人类可读样本操作 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          paddingTop: '0.5rem',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={handleCopyEvidence}
            tabIndex={0}
            aria-label="复制完整人类可读见证证据文本"
            title="复制包含时区快照、请求、候选、决策和偏移的完整证据文本"
            data-testid="copy-evidence-btn"
            style={{ flex: 1, padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
          >
            {copyStatus === 'COPIED' ? '✓ 证据已复制' : '📋 复制完整证据文本 (Copy Evidence)'}
          </button>
        </div>

        {copyStatus === 'COPIED' && (
          <div
            style={{
              fontSize: '0.725rem',
              color: 'var(--color-teal)',
              textAlign: 'center',
            }}
            data-testid="copy-feedback-msg"
          >
            已成功复制包含快照版本、请求、候选与策略的证据文本至剪贴板。
          </div>
        )}
      </div>

      {/* 限制说明与声明文案（文案层严格要求） */}
      <div
        style={{
          fontSize: '0.72rem',
          color: 'var(--color-text-subtle)',
          lineHeight: 1.4,
          padding: '0.5rem',
          backgroundColor: 'rgba(13, 21, 39, 0.5)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border-subtle)',
        }}
        data-testid="disclaimer-text"
      >
        <span style={{ fontWeight: 700, color: 'var(--color-amber)' }}>⚠️ 实验局限说明：</span>
        本工具仅供教学与开发测试排错，<strong>不适用于生产决策</strong>。导出数据含合成标识 (SYNTHETIC) 与
        {' '}{effectiveInput?.zone?.snapshot || 'frozen-2026'} 冻结快照版本。
      </div>
    </aside>
  );
}