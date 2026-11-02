/**
 * P009 时隙镜 TimeFold — 预设条组件
 * 严格遵从 PROJECT_BOOK.md §4.1, §4.2, §7 与 TASK-P009-T011。
 *
 * 核心要求：
 * 1. 完整展示 TF-A 至 TF-F 六个预设切换按钮：
 *    - TF-A: 纽约春季缺口 (Spring Gap)
 *    - TF-B: 纽约双生一刻 (Fall Fold) [默认加载]
 *    - TF-C: 伦敦春季缺口 (London Spring Gap)
 *    - TF-D: 伦敦秋季重叠 (London Fall Fold)
 *    - TF-E: 东京每日对照常态 (Tokyo Daily)
 *    - TF-F: 纽约每周一固定间隔漂移 (Fixed Interval Drift)
 * 2. 状态标示：高亮当前激活预设（如 TF-B●），支持键盘 Tab 聚焦与回车触发。
 * 3. 讲解条与映射说明：展示当前场景的 0/1/2 UTC 映射机制。
 */

import React from 'react';
import { getAllPresets, type PresetId, getPreset } from '../data/presets';

export interface PresetBarProps {
  activePresetId: PresetId | null;
  onSelectPreset: (presetId: PresetId) => void;
  disabled?: boolean | undefined;
}

export function PresetBar({
  activePresetId,
  onSelectPreset,
  disabled = false,
}: PresetBarProps): React.JSX.Element {
  const presets = getAllPresets();
  const currentPresetInfo = activePresetId ? getPreset(activePresetId) : null;

  return (
    <nav className="preset-bar-panel" aria-label="时隙镜预设场景选择">
      <div className="preset-controls-row">
        <span className="preset-label-lead">预设场景 (TF-A..F):</span>
        {presets.map((preset) => {
          const isActive = preset.id === activePresetId;
          return (
            <button
              key={preset.id}
              type="button"
              className={`preset-button ${isActive ? 'active' : ''}`}
              onClick={() => onSelectPreset(preset.id)}
              disabled={disabled}
              aria-pressed={isActive}
              aria-label={`选择预设 ${preset.id}: ${preset.name}`}
              title={`${preset.name}: ${preset.description}`}
              tabIndex={0}
            >
              {isActive && (
                <span className="preset-active-indicator" aria-hidden="true" />
              )}
              <span>{preset.id}</span>
              {isActive && <span aria-hidden="true">●</span>}
            </button>
          );
        })}
      </div>

      <div className="preset-details-row">
        <div className="preset-desc-text">
          {currentPresetInfo ? (
            <span>
              <strong>{currentPresetInfo.name}</strong> — {currentPresetInfo.description}
            </span>
          ) : (
            <span style={{ color: 'var(--color-amber)' }}>
              <strong>自定义配置</strong> — 已修改输入参数，当前偏离标准预设基线。
            </span>
          )}
        </div>
        <div className="preset-mapping-note">
          0/1/2 UTC 映射机制：[0=GAP跳时] · [1=NORMAL常态] · [2=FOLD折返双反像]
        </div>
      </div>
    </nav>
  );
}

export default PresetBar;
