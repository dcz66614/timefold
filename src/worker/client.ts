/**
 * P009 时隙镜 TimeFold — Dedicated Worker 客户端与状态机
 *
 * 严格遵从 PROJECT_BOOK.md §6.3、§9 FR11 与 IMPLEMENTATION_PLAN.md §2.3、§5 T010。
 *
 * 核心设计与竞态保障：
 * 1. 唯一 Worker 实例：全仓代码检索仅允许存在一个 Dedicated Worker 创建点，绝不通过多 Worker 并行；
 * 2. 单调递增 runId：每次用户派发计算单调递增 runId 并记录为 activeRunId；
 * 3. 严格 runId 比对：主线程严格检查 `response.runId === activeRunId`；
 *    - 迟到结果/过期错误一律被判定为无效，绝不更新 activeRunId、committedRunId 或结果状态；
 * 4. 逻辑取消 (Logical Cancellation)：
 *    - 取消操作立即使 activeRunId 失效 (置为 null)，屏蔽后续所有该批次的迟滞返回；
 *    - 向 Worker 发送 CANCEL 请求；
 *    - 不承诺抢占已在 Worker 内部进行的同步纯计算。
 */

import type { TimeFoldInput, AnalysisResult } from '../core/types';
import { TimeFoldError } from '../core/types';
import {
  type WorkerRequest,
  type WorkerResponse,
  type WorkerErrorResponse,
  isWorkerResponse,
} from './protocol';

/**
 * Worker 通信接口最小抽象（用于浏览器原生 Worker 与单元测试注入）
 */
export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  terminate?(): void;
}

/** 客户端状态快照 */
export type ClientState = {
  activeRunId: number | null;
  committedRunId: number | null;
  isBusy: boolean;
  latestResult: AnalysisResult | null;
  latestError: WorkerErrorResponse | null;
};

/** 状态订阅者回调 */
export type ClientSubscriber = (state: ClientState) => void;

/** 单次调用的回调选项 */
export type AnalysisCallbacks = {
  onResult?: (result: AnalysisResult) => void;
  onError?: (error: WorkerErrorResponse) => void;
  onCancel?: () => void;
};

/** 全仓全局唯一的 Worker 实例引用 */
let singletonWorker: Worker | null = null;

/**
 * 获取全仓唯一的 Dedicated Worker 实例
 *
 * 注意：此处是全仓代码唯一的 Dedicated Worker 构造创建点。
 */
export function getOrCreateSharedWorker(): Worker {
  if (!singletonWorker) {
    if (typeof Worker === 'undefined') {
      throw new Error('Web Worker is not supported in the current environment');
    }
    singletonWorker = new Worker(
      new URL('./timefold.worker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return singletonWorker;
}

/**
 * TimeFold Dedicated Worker 客户端驱动
 */
export class TimeFoldClient {
  private worker: WorkerLike;
  private activeRunId: number | null = null;
  private committedRunId: number | null = null;
  private isBusy = false;
  private latestResult: AnalysisResult | null = null;
  private latestError: WorkerErrorResponse | null = null;
  private nextRunId = 1;
  private subscribers = new Set<ClientSubscriber>();
  private pendingCallbacks: AnalysisCallbacks | null = null;

  constructor(customWorker?: WorkerLike) {
    if (customWorker) {
      this.worker = customWorker;
    } else {
      this.worker = getOrCreateSharedWorker();
    }

    this.worker.addEventListener('message', this.handleWorkerMessageEvent);
  }

  private handleWorkerMessageEvent = (event: MessageEvent<unknown>): void => {
    this.onWorkerMessage(event.data);
  };

  /**
   * 处理 Worker 返回的响应
   *
   * @param response 未知消息或结构化响应
   * @returns boolean 是否匹配 activeRunId 并成功更新状态
   */
  public onWorkerMessage(response: unknown): boolean {
    if (!isWorkerResponse(response)) {
      return false;
    }

    // 严格检查 runId：假迟到结果或已取消任务一律屏蔽，绝不入状态
    if (this.activeRunId === null || response.runId !== this.activeRunId) {
      return false;
    }

    const currentCallbacks = this.pendingCallbacks;
    this.pendingCallbacks = null;
    this.committedRunId = response.runId;
    this.isBusy = false;

    if (response.kind === 'RESULT') {
      this.latestResult = response.result;
      this.latestError = null;
      this.notifySubscribers();
      currentCallbacks?.onResult?.(response.result);
      return true;
    }

    if (response.kind === 'ERROR') {
      this.latestError = response;
      this.latestResult = null;
      this.notifySubscribers();
      currentCallbacks?.onError?.(response);
      return true;
    }

    return false;
  }

  /**
   * 派发新的计算请求
   *
   * 行为：
   * - 递增 runId 并赋予 activeRunId；
   * - 若前一次计算尚未完成，逻辑作废前一次计算（触发前一请求的 onCancel 回调）；
   * - 将 isBusy 置为 true，向 Worker 发送 ANALYZE 请求。
   *
   * @returns 分配的 runId
   */
  public dispatch(input: TimeFoldInput, callbacks?: AnalysisCallbacks): number {
    if (this.pendingCallbacks) {
      const prev = this.pendingCallbacks;
      this.pendingCallbacks = null;
      prev.onCancel?.();
    }

    const runId = this.nextRunId++;
    this.activeRunId = runId;
    this.isBusy = true;
    this.pendingCallbacks = callbacks || null;

    this.notifySubscribers();

    const request: WorkerRequest = {
      kind: 'ANALYZE',
      runId,
      input,
    };
    this.worker.postMessage(request);

    return runId;
  }

  /**
   * 逻辑取消当前活跃的计算请求
   *
   * 行为：
   * - 立即将 activeRunId 设为 null，isBusy 设为 false；
   * - 触发当前待决任务的 onCancel；
   * - 向 Worker 发送 CANCEL 请求；
   * - 所有未完成计算的迟到返回均将被严格屏蔽，不污染 UI。
   */
  public cancel(): void {
    if (this.activeRunId !== null) {
      const cancelledRunId = this.activeRunId;
      this.activeRunId = null;
      this.isBusy = false;

      if (this.pendingCallbacks) {
        const prev = this.pendingCallbacks;
        this.pendingCallbacks = null;
        prev.onCancel?.();
      }

      const request: WorkerRequest = {
        kind: 'CANCEL',
        runId: cancelledRunId,
      };
      try {
        this.worker.postMessage(request);
      } catch {
        // 忽略投递异常
      }

      this.notifySubscribers();
    }
  }

  /**
   * Promise 封装调用方式
   *
   * 若任务被后续 dispatch 覆盖或被 cancel() 取消，Promise 将以 Error 拒绝。
   */
  public analyze(input: TimeFoldInput): Promise<AnalysisResult> {
    return new Promise<AnalysisResult>((resolve, reject) => {
      this.dispatch(input, {
        onResult: (result) => resolve(result),
        onError: (err) => {
          reject(
            new TimeFoldError({
              code: err.code,
              path: err.path,
              message: err.message,
            })
          );
        },
        onCancel: () => {
          reject(new Error('Operation cancelled or superseded by newer request'));
        },
      });
    });
  }

  /** 获取当前状态快照 */
  public getState(): ClientState {
    return {
      activeRunId: this.activeRunId,
      committedRunId: this.committedRunId,
      isBusy: this.isBusy,
      latestResult: this.latestResult,
      latestError: this.latestError,
    };
  }

  public getActiveRunId(): number | null {
    return this.activeRunId;
  }

  public getCommittedRunId(): number | null {
    return this.committedRunId;
  }

  public getLatestResult(): AnalysisResult | null {
    return this.latestResult;
  }

  public getLatestError(): WorkerErrorResponse | null {
    return this.latestError;
  }

  public getIsBusy(): boolean {
    return this.isBusy;
  }

  /** 订阅状态更新 */
  public subscribe(subscriber: ClientSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.getState());
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private notifySubscribers(): void {
    const state = this.getState();
    for (const sub of this.subscribers) {
      try {
        sub(state);
      } catch {
        // 忽略订阅者内部未捕获异常
      }
    }
  }

  /** 重置客户端状态 */
  public reset(): void {
    this.cancel();
    this.committedRunId = null;
    this.latestResult = null;
    this.latestError = null;
    this.notifySubscribers();
  }

  /** 销毁客户端，断开监听并终止 Worker */
  public destroy(): void {
    this.cancel();
    this.worker.removeEventListener('message', this.handleWorkerMessageEvent);
    this.worker.terminate?.();
    if (singletonWorker === (this.worker as unknown as Worker)) {
      singletonWorker = null;
    }
    this.subscribers.clear();
  }
}

/** 默认全局单例客户端 */
let sharedClientInstance: TimeFoldClient | null = null;

export function getSharedClient(): TimeFoldClient {
  if (!sharedClientInstance) {
    sharedClientInstance = new TimeFoldClient();
  }
  return sharedClientInstance;
}
