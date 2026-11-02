/**
 * P009 时隙镜 TimeFold — Dedicated Worker 通信协议
 * 严格遵从 PROJECT_BOOK.md §6.3 与 IMPLEMENTATION_PLAN.md §2.3。
 */

import type { TimeFoldInput, AnalysisResult } from '../core/types';

export type WorkerAnalyzeRequest = {
  kind: 'ANALYZE';
  runId: number;
  input: TimeFoldInput;
};

export type WorkerCancelRequest = {
  kind: 'CANCEL';
  runId: number;
};

/** 主线程发给 Worker 的请求 */
export type WorkerRequest = WorkerAnalyzeRequest | WorkerCancelRequest;

export type WorkerResultResponse = {
  kind: 'RESULT';
  runId: number;
  result: AnalysisResult;
};

export type WorkerErrorResponse = {
  kind: 'ERROR';
  runId: number;
  code: string;
  path: string;
  message: string;
};

/** Worker 返回给主线程的响应 */
export type WorkerResponse = WorkerResultResponse | WorkerErrorResponse;

/** 运行时守卫：检查未知消息是否符合 WorkerRequest 结构 */
export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['runId'] !== 'number') return false;

  if (candidate['kind'] === 'ANALYZE') {
    return typeof candidate['input'] === 'object' && candidate['input'] !== null;
  }
  if (candidate['kind'] === 'CANCEL') {
    return true;
  }
  return false;
}

/** 运行时守卫：检查未知消息是否符合 WorkerResponse 结构 */
export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['runId'] !== 'number') return false;

  if (candidate['kind'] === 'RESULT') {
    return typeof candidate['result'] === 'object' && candidate['result'] !== null;
  }
  if (candidate['kind'] === 'ERROR') {
    return (
      typeof candidate['code'] === 'string' &&
      typeof candidate['path'] === 'string' &&
      typeof candidate['message'] === 'string'
    );
  }
  return false;
}
