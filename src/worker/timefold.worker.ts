/**
 * P009 时隙镜 TimeFold — Dedicated Web Worker
 *
 * 严格遵从 PROJECT_BOOK.md §6.1、§6.3 与 IMPLEMENTATION_PLAN.md §2.3、§5 T010。
 *
 * 【架构与设计决策记录 (ADR: Canonical JSON & SHA-256 Digest)】
 * 1. 纯计算与副作用分离：
 *    - `analyze(input)` 是纯数学同步纯计算，输出不含 `digest` 的 AnalysisComputation；
 *    - Worker 负责运行环境相关的 Web Crypto 摘要计算，并组装完整的 AnalysisResult。
 * 2. 键序方案与规范化序列化 (Canonical JSON Serialization)：
 *    - 对象属性排序：所有对象的键均使用 Unicode 标量/UTF-16 代码单元升序排序（即 `Object.keys(obj).sort()`）；
 *    - 递归处理：嵌套对象递归进行键排序，确保任意层级键序固定；
 *    - 数组保持顺序：数组项索引代表语义顺序（如 candidatesUtc、selectedUtc、occurrences），保持原有索引顺序递归序列化；
 *    - 基础类型：数字、字符串、布尔值、null 均采用标准 JSON 格式编码；
 *    - 属性过滤：忽略 undefined、函数与 Symbol 属性；
 *    - 零副作用：严禁在摘要输入中混入 Date.now()、Math.random()、PID、UUID 或主机环境信息。
 * 3. UTF-8 编码与摘要算法细节：
 *    - 规范化 JSON 字符串经由 `TextEncoder` 编码为紧凑的 UTF-8 字节流 (`Uint8Array`)；
 *    - 调用 Web Crypto 标准 API：`crypto.subtle.digest('SHA-256', bytes)`；
 *    - 摘要结果转为 64 位定长纯小写十六进制字符串（256 位 / 32 字节）；
 *    - 保证相同输入的计算结果在任何时刻、任何平台重复计算所得 digest 逐字完全一致。
 * 4. 协议合同与错误序列化：
 *    - 遵从 protocol.ts 冻结合同：WorkerRequest (ANALYZE / CANCEL) -> WorkerResponse (RESULT / ERROR)；
 *    - 捕获 TimeFoldError 时保留其 code、path、message 结构化字段；
 *    - 捕获其他未知 Error 时统一收敛为结构化 ERROR 响应。
 */

import { analyze } from '../core/analyze';
import {
  type AnalysisComputation,
  type AnalysisResult,
  TimeFoldError,
} from '../core/types';
import {
  type WorkerResponse,
  type WorkerResultResponse,
  type WorkerErrorResponse,
  isWorkerRequest,
} from './protocol';

/**
 * 递归规范化 JSON 序列化器
 *
 * 依据 ADR 规则，对对象所有键进行字典升序排序，排除非 JSON 字段与不确定性因素。
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const serializedItems = value.map((item) => {
      const res = canonicalJsonStringify(item);
      return res === undefined ? 'null' : res;
    });
    return `[${serializedItems.join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries: string[] = [];

  for (const key of sortedKeys) {
    const val = obj[key];
    if (val !== undefined && typeof val !== 'function' && typeof val !== 'symbol') {
      entries.push(`${JSON.stringify(key)}:${canonicalJsonStringify(val)}`);
    }
  }

  return `{${entries.join(',')}}`;
}

/**
 * 使用 Web Crypto crypto.subtle.digest('SHA-256', ...) 计算规范化 UTF-8 数据的确定性哈希
 */
export async function computeDigest(computation: AnalysisComputation): Promise<string> {
  const canonicalJson = canonicalJsonStringify(computation);
  const utf8Bytes = new TextEncoder().encode(canonicalJson);

  const cryptoInstance =
    typeof crypto !== 'undefined'
      ? crypto
      : (globalThis as unknown as { crypto: Crypto }).crypto;

  if (!cryptoInstance?.subtle?.digest) {
    throw new Error('Web Crypto API (crypto.subtle.digest) is unavailable in current runtime');
  }

  const buffer = await cryptoInstance.subtle.digest('SHA-256', utf8Bytes);
  const hashArray = new Uint8Array(buffer);
  let hexString = '';
  for (let i = 0; i < hashArray.length; i++) {
    hexString += hashArray[i]!.toString(16).padStart(2, '0');
  }
  return hexString;
}

/**
 * 处理单条 Worker 请求并返回 WorkerResponse（若为 CANCEL 或不合法请求且无法关联 runId 则返回 null）
 */
export async function handleWorkerRequest(
  request: unknown
): Promise<WorkerResponse | null> {
  if (!isWorkerRequest(request)) {
    // 若无法识别为 WorkerRequest，但能探测到有效数字 runId，则返回结构化错误响应
    if (
      request &&
      typeof request === 'object' &&
      typeof (request as Record<string, unknown>)['runId'] === 'number'
    ) {
      const errorResp: WorkerErrorResponse = {
        kind: 'ERROR',
        runId: (request as Record<string, unknown>)['runId'] as number,
        code: 'E_INVALID_REQUEST',
        path: '$',
        message: 'Invalid worker request payload or structure',
      };
      return errorResp;
    }
    return null;
  }

  if (request.kind === 'CANCEL') {
    // 逻辑取消：protocol.ts 协议仅定义 RESULT 与 ERROR，取消操作无需向主线程回复报文
    return null;
  }

  if (request.kind === 'ANALYZE') {
    const { runId, input } = request;
    try {
      // 1. 执行同步核心分析（若校验失败会抛出结构化 TimeFoldError）
      const computation: AnalysisComputation = analyze(input);

      // 2. 异步计算确定性 SHA-256 digest
      const digest = await computeDigest(computation);

      // 3. 装配完整的 AnalysisResult
      const result: AnalysisResult = {
        ...computation,
        digest,
      };

      const resultResponse: WorkerResultResponse = {
        kind: 'RESULT',
        runId,
        result,
      };
      return resultResponse;
    } catch (err: unknown) {
      let code = 'E_INTERNAL';
      let path = '$';
      let message = 'Unknown worker calculation error';

      if (err instanceof TimeFoldError) {
        code = err.code;
        path = err.path;
        message = err.message;
      } else if (err instanceof Error) {
        message = err.message;
        if ('code' in err && typeof (err as Record<string, unknown>)['code'] === 'string') {
          code = (err as Record<string, unknown>)['code'] as string;
        }
        if ('path' in err && typeof (err as Record<string, unknown>)['path'] === 'string') {
          path = (err as Record<string, unknown>)['path'] as string;
        }
      }

      const errorResponse: WorkerErrorResponse = {
        kind: 'ERROR',
        runId,
        code,
        path,
        message,
      };
      return errorResponse;
    }
  }

  return null;
}

// 在 Dedicated Worker 环境中自动挂载 message 监听器
if (
  typeof self !== 'undefined' &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function' &&
  typeof (self as unknown as { addEventListener?: unknown }).addEventListener === 'function'
) {
  self.addEventListener('message', async (event: MessageEvent<unknown>) => {
    const response = await handleWorkerRequest(event.data);
    if (response !== null) {
      (self as unknown as { postMessage: (msg: unknown) => void }).postMessage(response);
    }
  });
}
