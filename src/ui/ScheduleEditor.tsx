/**
 * P009 时隙镜 TimeFold — 输入与政策编辑器组件
 * 严格遵从 PROJECT_BOOK.md §4.2, §4.3, §6 与 TASK-P009-T011。
 *
 * 核心要求：
 * 1. zone 选择（冻结 2026 快照）：纽约、伦敦、东京、UTC。
 * 2. localTime 输入：HH:mm 严格格式（如 01:30、02:30）。
 * 3. 调度频次：once / daily / weekly。
 *    - 当 weekly 时，展示 ISO 星期 1..7 (周一至周日) 多选按钮组。
 *    - 当 once 时，endDate 自动同步 startDate 并保持禁用。
 * 4. 日期范围：startDate 与 endDate (YYYY-MM-DD)。
 * 5. 策略选项：
 *    - gapPolicy (缺失时刻): skip (跳过) / shiftForward (顺移至有效时刻)。
 *    - foldPolicy (折返重叠): earlier (较早) / later (较晚) / both (两者并列)。
 * 6. 交互操作：
 *    - [运行分析] 触发计算。
 *    - [重置] 还原为当前预设或初始状态。
 *    - [导入 JSON] 通过文件选择器安全读取文本并触发导入。
 * 7. 辅助功能：全面支持键盘 Tab 导航、高亮聚焦与无障碍标签。
 */

import React, { useRef } from 'react';
import type {
  TimeFoldInput,
  ScheduleFrequency,
  SchedulePolicyGap,
  SchedulePolicyFold,
} from '../core/types';
import { FROZEN_ZONES, getFrozenZone } from '../core/zones';

export interface ScheduleEditorProps {
  input: TimeFoldInput;
  onChange: (nextInput: TimeFoldInput) => void;
  onRun: () => void;
  onReset: () => void;
  onImport: (jsonContent: string) => void;
  isCalculating?: boolean | undefined;
  isDirty?: boolean | undefined;
}

const WEEKDAY_LABELS: ReadonlyArray<{ day: number; label: string }> = [
  { day: 1, label: '一' },
  { day: 2, label: '二' },
  { day: 3, label: '三' },
  { day: 4, label: '四' },
  { day: 5, label: '五' },
  { day: 6, label: '六' },
  { day: 7, label: '日' },
];

export function ScheduleEditor({
  input,
  onChange,
  onRun,
  onReset,
  onImport,
  isCalculating = false,
  isDirty = false,
}: ScheduleEditorProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 1. 时区切换处理
  const handleZoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const label = e.target.value;
    const newZone = getFrozenZone(label);
    if (!newZone) return;
    onChange({
      ...input,
      zone: newZone,
    });
  };

  // 2. 本地时间输入处理
  const handleLocalTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...input,
      schedule: {
        ...input.schedule,
        localTime: e.target.value,
      },
    });
  };

  // 3. 频次切换处理
  const handleFrequencyChange = (frequency: ScheduleFrequency) => {
    let nextEndDate = input.schedule.endDate;
    let nextByWeekday = [...input.schedule.byWeekday];

    if (frequency === 'once') {
      nextEndDate = input.schedule.startDate;
      nextByWeekday = [];
    } else if (frequency === 'weekly' && nextByWeekday.length === 0) {
      nextByWeekday = [1]; // 默认至少周一
    } else if (frequency === 'daily') {
      nextByWeekday = [];
    }

    onChange({
      ...input,
      schedule: {
        ...input.schedule,
        frequency,
        endDate: nextEndDate,
        byWeekday: nextByWeekday,
      },
    });
  };

  // 4. 起止日期处理
  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const nextEndDate = input.schedule.frequency === 'once' ? val : input.schedule.endDate;
    onChange({
      ...input,
      schedule: {
        ...input.schedule,
        startDate: val,
        endDate: nextEndDate,
      },
    });
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...input,
      schedule: {
        ...input.schedule,
        endDate: e.target.value,
      },
    });
  };

  // 5. ISO 星期切换 (1..7)
  const toggleWeekday = (day: number) => {
    const current = new Set(input.schedule.byWeekday);
    if (current.has(day)) {
      if (current.size > 1) {
        current.delete(day);
      }
    } else {
      current.add(day);
    }
    const sorted = Array.from(current).sort((a, b) => a - b);
    onChange({
      ...input,
      schedule: {
        ...input.schedule,
        byWeekday: sorted,
      },
    });
  };

  // 6. 策略处理
  const handleGapPolicyChange = (gap: SchedulePolicyGap) => {
    onChange({
      ...input,
      policy: {
        ...input.policy,
        gap,
      },
    });
  };

  const handleFoldPolicyChange = (fold: SchedulePolicyFold) => {
    onChange({
      ...input,
      policy: {
        ...input.policy,
        fold,
      },
    });
  };

  // 7. 文件导入触发与读取
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        onImport(content);
      }
    };
    reader.readAsText(file);
    // 重置 input 以便连续选取同一文件
    e.target.value = '';
  };

  return (
    <form
      className="editor-card"
      aria-label="输入与调度政策配置面板"
      onSubmit={(e) => {
        e.preventDefault();
        onRun();
      }}
    >
      <div className="panel-header-title">
        <span>输入与政策参数</span>
        {isDirty && (
          <span className="badge-tag badge-synthetic" title="参数发生变动">
            DIRTY
          </span>
        )}
      </div>

      {/* 时区选择 */}
      <div className="form-field-group">
        <label htmlFor="editor-zone-select" className="field-label">
          冻结时区快照 (2026 Zone)
        </label>
        <select
          id="editor-zone-select"
          className="select-input"
          value={input.zone.label}
          onChange={handleZoneChange}
          disabled={isCalculating}
        >
          {FROZEN_ZONES.map((z) => (
            <option key={z.label} value={z.label}>
              {z.label}
            </option>
          ))}
        </select>
      </div>

      {/* 本地墙上时间 */}
      <div className="form-field-group">
        <label htmlFor="editor-local-time" className="field-label">
          本地时间 Local Time (HH:mm)
        </label>
        <input
          id="editor-local-time"
          type="text"
          className="text-input"
          value={input.schedule.localTime}
          onChange={handleLocalTimeChange}
          placeholder="01:30"
          pattern="^([01]\d|2[0-3]):[0-5]\d$"
          disabled={isCalculating}
        />
      </div>

      {/* 调度频次 */}
      <div className="form-field-group">
        <span className="field-label">调度频次 (Frequency)</span>
        <div className="radio-pill-group" role="radiogroup" aria-label="调度频次">
          {(['once', 'daily', 'weekly'] as const).map((freq) => {
            const isSelected = input.schedule.frequency === freq;
            return (
              <label
                key={freq}
                className={`radio-pill-label ${isSelected ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="schedule-frequency"
                  value={freq}
                  checked={isSelected}
                  onChange={() => handleFrequencyChange(freq)}
                  className="radio-pill-input"
                  disabled={isCalculating}
                />
                {freq === 'once' ? '单次 (once)' : freq === 'daily' ? '每日 (daily)' : '每周 (weekly)'}
              </label>
            );
          })}
        </div>
      </div>

      {/* 每周选项：ISO 星期 1..7 */}
      {input.schedule.frequency === 'weekly' && (
        <div className="form-field-group">
          <span className="field-label">重复星期 (byWeekday 1..7)</span>
          <div className="weekday-selector" role="group" aria-label="选择每周执行日">
            {WEEKDAY_LABELS.map(({ day, label }) => {
              const active = input.schedule.byWeekday.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  className={`weekday-btn ${active ? 'active' : ''}`}
                  onClick={() => toggleWeekday(day)}
                  disabled={isCalculating}
                  aria-pressed={active}
                  aria-label={`星期${label}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 日期范围 */}
      <div className="form-field-group">
        <label htmlFor="editor-start-date" className="field-label">
          开始日期 Start Date (YYYY-MM-DD)
        </label>
        <input
          id="editor-start-date"
          type="text"
          className="text-input"
          value={input.schedule.startDate}
          onChange={handleStartDateChange}
          placeholder="2026-03-08"
          pattern="^\d{4}-\d{2}-\d{2}$"
          disabled={isCalculating}
        />
      </div>

      <div className="form-field-group">
        <label htmlFor="editor-end-date" className="field-label">
          结束日期 End Date (YYYY-MM-DD)
        </label>
        <input
          id="editor-end-date"
          type="text"
          className="text-input"
          value={input.schedule.endDate}
          onChange={handleEndDateChange}
          placeholder="2026-11-01"
          pattern="^\d{4}-\d{2}-\d{2}$"
          disabled={isCalculating || input.schedule.frequency === 'once'}
          title={input.schedule.frequency === 'once' ? '单次任务结束日期与开始日期同步' : undefined}
        />
      </div>

      {/* 策略：跳时缺口 (Gap Policy) */}
      <div className="form-field-group">
        <span className="field-label">跳时缺口裁决 (Gap Policy)</span>
        <div className="radio-pill-group" role="radiogroup" aria-label="跳时缺口策略">
          <label
            className={`radio-pill-label ${input.policy.gap === 'skip' ? 'selected' : ''}`}
          >
            <input
              type="radio"
              name="policy-gap"
              value="skip"
              checked={input.policy.gap === 'skip'}
              onChange={() => handleGapPolicyChange('skip')}
              className="radio-pill-input"
              disabled={isCalculating}
            />
            跳过 (skip)
          </label>
          <label
            className={`radio-pill-label ${input.policy.gap === 'shiftForward' ? 'selected' : ''}`}
          >
            <input
              type="radio"
              name="policy-gap"
              value="shiftForward"
              checked={input.policy.gap === 'shiftForward'}
              onChange={() => handleGapPolicyChange('shiftForward')}
              className="radio-pill-input"
              disabled={isCalculating}
            />
            顺移 (shiftForward)
          </label>
        </div>
      </div>

      {/* 策略：折返重叠 (Fold Policy) */}
      <div className="form-field-group">
        <span className="field-label">折返重叠裁决 (Fold Policy)</span>
        <div className="radio-pill-group" role="radiogroup" aria-label="折返重叠策略">
          <label
            className={`radio-pill-label ${input.policy.fold === 'earlier' ? 'selected' : ''}`}
          >
            <input
              type="radio"
              name="policy-fold"
              value="earlier"
              checked={input.policy.fold === 'earlier'}
              onChange={() => handleFoldPolicyChange('earlier')}
              className="radio-pill-input"
              disabled={isCalculating}
            />
            较早 (earlier)
          </label>
          <label
            className={`radio-pill-label ${input.policy.fold === 'later' ? 'selected' : ''}`}
          >
            <input
              type="radio"
              name="policy-fold"
              value="later"
              checked={input.policy.fold === 'later'}
              onChange={() => handleFoldPolicyChange('later')}
              className="radio-pill-input"
              disabled={isCalculating}
            />
            较晚 (later)
          </label>
          <label
            className={`radio-pill-label ${input.policy.fold === 'both' ? 'selected' : ''}`}
          >
            <input
              type="radio"
              name="policy-fold"
              value="both"
              checked={input.policy.fold === 'both'}
              onChange={() => handleFoldPolicyChange('both')}
              className="radio-pill-input"
              disabled={isCalculating}
            />
            并列 (both)
          </label>
        </div>
      </div>

      {/* 操作按钮区 */}
      <div className="action-buttons-row">
        <button
          type="submit"
          className="btn-primary"
          disabled={isCalculating}
          tabIndex={0}
          aria-label="执行时间折叠与漂移分析"
        >
          {isCalculating ? '计算中...' : '运行分析'}
        </button>

        <button
          type="button"
          className="btn-secondary"
          onClick={onReset}
          disabled={isCalculating}
          tabIndex={0}
          aria-label="重置参数为预设"
        >
          重置
        </button>

        <button
          type="button"
          className="btn-outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isCalculating}
          tabIndex={0}
          aria-label="导入 JSON 配置文件"
        >
          导入 JSON
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          aria-label="选择导入的 JSON 文件"
        />
      </div>
    </form>
  );
}

export default ScheduleEditor;
