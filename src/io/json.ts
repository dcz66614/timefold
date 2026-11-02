/**
 * P009 时隙镜 TimeFold — 安全 JSON 导入导出与防御模块
 *
 * 严格遵从 PROJECT_BOOK.md §5.5、§6.1 与 IMPLEMENTATION_PLAN.md §5 T009、TASK-P009-T009。
 *
 * 安全要点：
 * 1. 纯 UTF-8 JSON，大小硬性限制 256 KiB (262,144 字节)。
 * 2. 拒绝任何原型污染字段 (__proto__, constructor, prototype)。
 * 3. 严格字段白名单：
 *    - 纯输入格式：schema 必须为 timefold.spec/1，由 validateInput 实行字段白名单；
 *    - 导出包裹格式：schema 必须为 timefold.export/1，顶层仅允许 schema, input, result。
 * 4. 忽略不可信 result 并重算：导入包裹格式时丢弃传入的 result，仅对 input 校验并以核心 analyze 重算。
 * 5. 损坏 JSON 不覆盖当前有效状态（解析过程为纯函数，遇到错误立即抛出 TimeFoldError）。
 * 6. 导出格式固定顶层键顺序：schema -> input -> result，无用户名和访问时间戳。
 * 7. 导出文件名推荐：timefold-<preset-id>.json。
 */

import {
  type TimeFoldInput,
  type AnalysisResult,
  type AnalysisComputation,
  type TimeFoldExport,
  TIMEFOLD_SPEC_SCHEMA,
  TIMEFOLD_EXPORT_SCHEMA,
  TimeFoldError,
} from '../core/types';
import { validateInput, MAX_JSON_BYTES } from '../core/validate';
import { analyze } from '../core/analyze';

/** 导出包裹顶层允许的字段白名单 */
const ALLOWED_EXPORT_TOP_KEYS = new Set(['schema', 'input', 'result']);

/** 原型污染危险属性集合 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 快速原型污染键正则匹配（作为前置强力防御，避免引擎内部对 __proto__ 的差异行为） */
const PROTO_POLLUTION_REGEX = /"(?:__proto__|constructor|prototype)"\s*:/;

/**
 * 递归检查对象所有层次是否存在原型污染属性
 */
function assertNoDeepPrototypePollution(val: unknown, pathPrefix: string = ''): void {
  if (typeof val !== 'object' || val === null) {
    return;
  }
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      assertNoDeepPrototypePollution(val[i], pathPrefix ? `${pathPrefix}[${i}]` : `[${i}]`);
    }
    return;
  }
  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (DANGEROUS_KEYS.has(k)) {
      const p = pathPrefix ? `${pathPrefix}.${k}` : k;
      throw new TimeFoldError({
        code: 'E_PROTOTYPE_POLLUTION',
        path: p,
        message: `Forbidden prototype pollution property: ${keyOrPath(p)}`,
      });
    }
    assertNoDeepPrototypePollution(obj[k], pathPrefix ? `${pathPrefix}.${k}` : k);
  }
}

function keyOrPath(p: string): string {
  const parts = p.split('.');
  return parts[parts.length - 1] || p;
}

/**
 * 安全解析 JSON 字符串，包含 256 KiB 大小检查、语法检查与 reviver 原型污染拦截
 */
export function safeJsonParse(text: string): unknown {
  if (typeof text !== 'string') {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: '',
      message: `Expected JSON text string, got ${typeof text}`,
    });
  }

  // 1. 256 KiB 大小限制检查 (UTF-8 字节)
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > MAX_JSON_BYTES) {
    throw new TimeFoldError({
      code: 'E_JSON_SIZE_EXCEEDED',
      path: '',
      message: `JSON text size (${byteLength} bytes) exceeds maximum limit of 256 KiB (${MAX_JSON_BYTES} bytes)`,
    });
  }

  // 2. 文本级别原型污染前置防御
  if (PROTO_POLLUTION_REGEX.test(text)) {
    const match = text.match(/"(__proto__|constructor|prototype)"\s*:/);
    const key = match ? match[1]! : '__proto__';
    throw new TimeFoldError({
      code: 'E_PROTOTYPE_POLLUTION',
      path: key,
      message: `Forbidden prototype pollution property: ${key}`,
    });
  }

  // 2. JSON.parse 解析与 reviver 检查
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, (key, value) => {
      if (DANGEROUS_KEYS.has(key)) {
        throw new TimeFoldError({
          code: 'E_PROTOTYPE_POLLUTION',
          path: key,
          message: `Forbidden prototype pollution property: ${key}`,
        });
      }
      return value;
    });
  } catch (err) {
    if (err instanceof TimeFoldError) {
      throw err;
    }
    throw new TimeFoldError({
      code: 'E_JSON_SYNTAX',
      path: '',
      message: `JSON syntax error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 3. 递归安全遍历二次防御
  assertNoDeepPrototypePollution(parsed);

  return parsed;
}

/**
 * 解析并校验已反序列化的数据对象。
 * 兼容纯输入 (timefold.spec/1) 与包裹格式 (timefold.export/1)。
 * 关键安全规则：若为包裹格式，丢弃其传入的 result，仅对 input 执行完整规范校验。
 */
export function parseTimeFoldData(data: unknown): TimeFoldInput {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: '',
      message: 'JSON root must be an object',
    });
  }

  assertNoDeepPrototypePollution(data);

  const raw = data as Record<string, unknown>;

  if (!('schema' in raw)) {
    throw new TimeFoldError({
      code: 'E_MISSING_PROPERTY',
      path: 'schema',
      message: 'Missing required property "schema"',
    });
  }

  const schema = raw.schema;

  // 格式 1: 包裹格式 timefold.export/1
  if (schema === TIMEFOLD_EXPORT_SCHEMA) {
    const topKeys = Object.keys(raw);
    for (const k of topKeys) {
      if (!ALLOWED_EXPORT_TOP_KEYS.has(k)) {
        throw new TimeFoldError({
          code: 'E_UNKNOWN_PROPERTY',
          path: k,
          message: `Unknown property "${k}" in export wrapper`,
        });
      }
    }

    if (!('input' in raw)) {
      throw new TimeFoldError({
        code: 'E_MISSING_PROPERTY',
        path: 'input',
        message: 'Missing required property "input" in export wrapper',
      });
    }

    // 关键安全点：丢弃可能不可信的 raw.result，仅校验并提取 raw.input
    return validateInput(raw.input);
  }

  // 格式 2: 纯输入格式 timefold.spec/1
  if (schema === TIMEFOLD_SPEC_SCHEMA) {
    return validateInput(raw);
  }

  // 未知或不支持的 schema
  throw new TimeFoldError({
    code: 'E_INVALID_SCHEMA',
    path: 'schema',
    message: `Unsupported schema "${String(schema)}". Expected "${TIMEFOLD_SPEC_SCHEMA}" or "${TIMEFOLD_EXPORT_SCHEMA}"`,
  });
}

/**
 * 从 JSON 文本解析并验证纯输入或包裹格式，返回纯净且合法的 TimeFoldInput。
 * 遇到损坏、越界或恶意字段时抛出 TimeFoldError，绝不产生破坏外部当前状态的副作用。
 */
export function parseTimeFoldJson(text: string): TimeFoldInput {
  const parsed = safeJsonParse(text);
  return parseTimeFoldData(parsed);
}

/**
 * 安全导入并以生产内核重新计算分析结果。
 * 绝对忽略外部传入的 result，强制以核心 analyze 重新计算。
 */
export function importAndAnalyze(text: string): {
  input: TimeFoldInput;
  result: AnalysisComputation;
} {
  const input = parseTimeFoldJson(text);
  const result = analyze(input);
  return {
    input,
    result,
  };
}

/**
 * 递归深度比较两个值是否完全相等 (支持纯 JSON 对象、数组、基元类型)
 */
export function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a)) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) {
      return false;
    }
    for (let i = 0; i < arrA.length; i++) {
      if (!isDeepEqual(arrA[i], arrB[i])) {
        return false;
      }
    }
    return true;
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) {
      return false;
    }
    if (!isDeepEqual(objA[key], objB[key])) {
      return false;
    }
  }
  return true;
}

/**
 * 序列化导出 TimeFold 任务结果为标准 JSON 字符串。
 *
 * 保证：
 * 1. 顶层键顺序固定：schema -> input -> result
 * 2. 纯 UTF-8 JSON 格式，2 空格缩进
 * 3. 无用户名、无访问时间戳、无客户端环境信息
 * 4. N01 下沉一致性校验：验证 result.input 与 input 深度一致，且 analyze(input) 重算的计算字段（排除 digest）与 result 深度一致
 */
export function exportTimeFold(
  input: TimeFoldInput,
  result: AnalysisResult | AnalysisComputation
): string {
  // 1. 对输入执行标准校验防御，防止未校验数据导出
  const validatedInput = validateInput(input);

  // 2. 校验 result 对象合法性
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new TimeFoldError({
      code: 'E_INVALID_TYPE',
      path: 'result',
      message: 'Export result must be an object',
    });
  }

  // 3. 验证 result 内含的 input 与传入 input 深度一致
  const rawResult = result as Record<string, unknown>;
  if (!('input' in rawResult) || !rawResult.input) {
    throw new TimeFoldError({
      code: 'E_MISSING_PROPERTY',
      path: 'result.input',
      message: 'Export result is missing "input" property',
    });
  }

  if (!isDeepEqual(rawResult.input, validatedInput)) {
    throw new TimeFoldError({
      code: 'E_RESULT_INPUT_MISMATCH',
      path: 'result.input',
      message: 'Export result.input does not match the provided input',
    });
  }

  // 4. 用 analyze(input) 重算的计算字段（排除 Worker 后补的 digest 字段）与 result 深度一致
  const recomputed = analyze(validatedInput);
  const computedKeys: (keyof AnalysisComputation)[] = [
    'schema',
    'input',
    'occurrences',
    'requestCount',
    'selectedCount',
    'firstWitness',
  ];

  for (const key of computedKeys) {
    if (!isDeepEqual(rawResult[key], recomputed[key])) {
      throw new TimeFoldError({
        code: 'E_RESULT_COMPUTATION_MISMATCH',
        path: `result.${key}`,
        message: `Export result.${key} does not match recomputed analysis`,
      });
    }
  }

  // 5. 构造顶层键顺序严格为 schema, input, result 的导出对象
  const exportPayload: TimeFoldExport = {
    schema: TIMEFOLD_EXPORT_SCHEMA,
    input: validatedInput,
    result: result as AnalysisResult,
  };

  return JSON.stringify(exportPayload, null, 2) + '\n';
}

/**
 * 生成符合项目书推荐规范的文件名：timefold-<preset-id>.json
 * 若未提供预设或无法匹配预设 ID，默认生成 timefold-export.json
 */
export function getExportFilename(presetIdOrInput?: string | TimeFoldInput): string {
  if (!presetIdOrInput) {
    return 'timefold-export.json';
  }

  let candidate = '';
  if (typeof presetIdOrInput === 'string') {
    candidate = presetIdOrInput.trim();
  } else if (typeof presetIdOrInput === 'object' && presetIdOrInput !== null) {
    candidate = presetIdOrInput.name || '';
  }

  // 匹配 TF-A 至 TF-F
  const match = candidate.match(/\bTF-[A-F]\b/i);
  if (match) {
    const id = match[0].toUpperCase();
    return `timefold-${id}.json`;
  }

  // 若直接传入了类似 "TF-A"
  if (/^TF-[A-F]$/i.test(candidate)) {
    return `timefold-${candidate.toUpperCase()}.json`;
  }

  return 'timefold-export.json';
}
