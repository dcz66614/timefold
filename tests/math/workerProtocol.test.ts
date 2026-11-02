/**
 * P009 时隙镜 TimeFold — Web Worker 协议、确定性摘要与并发防覆盖测试
 *
 * 严格遵从 PROJECT_BOOK.md §6.1、§6.3、§9 FR11 与 IMPLEMENTATION_PLAN.md §5 T010。
 *
 * 测试目标：
 * 1. 规范化键序 JSON (canonicalJsonStringify) 与确定性 SHA-256 (computeDigest) 稳定性；
 * 2. Dedicated Worker 请求处理 (handleWorkerRequest) 正确性、错误序列化与 CANCEL 行为；
 * 3. TimeFoldClient 竞态屏障：假迟到 RESULT/ERROR 绝不覆盖新状态、逻辑取消与零状态污染；
 * 4. 全仓代码检索只有一个 Dedicated Worker 实例化点的不变式断言。
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PRESETS,
  PRESET_TF_A,
  PRESET_TF_B,
  PRESET_TF_C,
  PRESET_TF_D,
  PRESET_TF_E,
  PRESET_TF_F,
} from '../../src/data/presets';
import { analyze } from '../../src/core/analyze';
import { TimeFoldError, type TimeFoldInput } from '../../src/core/types';
import {
  type WorkerRequest,
  type WorkerResponse,
  type WorkerResultResponse,
  type WorkerErrorResponse,
  isWorkerRequest,
  isWorkerResponse,
} from '../../src/worker/protocol';
import {
  canonicalJsonStringify,
  computeDigest,
  handleWorkerRequest,
} from '../../src/worker/timefold.worker';
import {
  TimeFoldClient,
  type WorkerLike,
  type ClientState,
} from '../../src/worker/client';

/**
 * 模拟 Worker 通信管道（用于在 Node / 测试环境中精细操控消息时序与竞态）
 */
class MockWorkerChannel implements WorkerLike {
  public sentRequests: WorkerRequest[] = [];
  public listeners: ((event: MessageEvent<unknown>) => void)[] = [];
  public terminated = false;

  postMessage(message: unknown): void {
    if (this.terminated) {
      throw new Error('Worker already terminated');
    }
    this.sentRequests.push(message as WorkerRequest);
  }

  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void
  ): void {
    if (type === 'message') {
      this.listeners.push(listener);
    }
  }

  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void
  ): void {
    if (type === 'message') {
      this.listeners = this.listeners.filter((l) => l !== listener);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  /** 测试辅助：模拟 Worker 向主线程回传响应 */
  deliverWorkerResponse(response: unknown): void {
    const event = { data: response } as MessageEvent<unknown>;
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** 测试辅助：以真实 handleWorkerRequest 自动回传响应（异步模拟） */
  async processAndRespond(req: WorkerRequest): Promise<void> {
    const resp = await handleWorkerRequest(req);
    if (resp !== null) {
      this.deliverWorkerResponse(resp);
    }
  }
}

describe('P009-T010: Web Worker Protocol & RunId Concurrency Protection', () => {
  describe('1. 稳定键序 JSON 序列化 (canonicalJsonStringify)', () => {
    it('不同键顺序的对象序列化为逐字完全相同的 JSON 文本', () => {
      const objA = { z: 1, a: 2, m: 3 };
      const objB = { a: 2, m: 3, z: 1 };
      const objC = { m: 3, z: 1, a: 2 };

      const strA = canonicalJsonStringify(objA);
      const strB = canonicalJsonStringify(objB);
      const strC = canonicalJsonStringify(objC);

      expect(strA).toBe('{"a":2,"m":3,"z":1}');
      expect(strA).toBe(strB);
      expect(strB).toBe(strC);
    });

    it('多层深度嵌套对象在任意层级乱序时均能得到唯一确定序列', () => {
      const deep1 = {
        outer: { beta: 'B', alpha: 'A' },
        list: [{ y: 2, x: 1 }, { d: 4, c: 3 }],
      };
      const deep2 = {
        list: [{ x: 1, y: 2 }, { c: 3, d: 4 }],
        outer: { alpha: 'A', beta: 'B' },
      };

      expect(canonicalJsonStringify(deep1)).toBe(canonicalJsonStringify(deep2));
      expect(canonicalJsonStringify(deep1)).toBe(
        '{"list":[{"x":1,"y":2},{"c":3,"d":4}],"outer":{"alpha":"A","beta":"B"}}'
      );
    });

    it('数组保留原始索引顺序，不擅自对元素重新排序', () => {
      const arr = [3, 1, 2];
      expect(canonicalJsonStringify(arr)).toBe('[3,1,2]');
    });

    it('正确序列化基础数据类型并过滤 undefined 与函数', () => {
      const mixed = {
        num: 42,
        str: 'hello',
        bool: true,
        nul: null,
        undef: undefined,
        fn: () => {},
      };
      expect(canonicalJsonStringify(mixed)).toBe(
        '{"bool":true,"nul":null,"num":42,"str":"hello"}'
      );
    });

    it('不包含任何系统时间、随机数或环境字段', () => {
      const comp = analyze(PRESET_TF_B);
      const serialized = canonicalJsonStringify(comp);
      expect(serialized).not.toContain('Date.now');
      expect(serialized).not.toContain('timestamp');
      expect(serialized).not.toContain('random');
      expect(serialized).not.toContain('uuid');
    });
  });

  describe('2. 确定性 SHA-256 摘要与稳定性 (computeDigest)', () => {
    it('摘要格式严格为 64 位小写十六进制字符串', async () => {
      const comp = analyze(PRESET_TF_A);
      const digest = await computeDigest(comp);

      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(digest.length).toBe(64);
    });

    it('对完全相同的输入连续两次计算 digest 逐字完全相同（幂等性）', async () => {
      const comp1 = analyze(PRESET_TF_B);
      const comp2 = analyze(PRESET_TF_B);

      const digest1 = await computeDigest(comp1);
      const digest2 = await computeDigest(comp2);

      expect(digest1).toBe(digest2);
    });

    it('输入产生微小变动时 digest 显著发生雪崩改变（防碰撞敏感性）', async () => {
      const baseInput = PRESET_TF_B;
      const modifiedInput: TimeFoldInput = {
        ...baseInput,
        schedule: {
          ...baseInput.schedule,
          localTime: '01:31', // 变动 1 分钟
        },
      };

      const digestBase = await computeDigest(analyze(baseInput));
      const digestModified = await computeDigest(analyze(modifiedInput));

      expect(digestBase).not.toBe(digestModified);
    });

    it('六个预设 TF-A 至 TF-F 均能稳定计算出唯一且各不相同的 digest', async () => {
      const digests = new Map<string, string>();

      for (const preset of PRESETS) {
        const comp = analyze(preset.input);
        const digest = await computeDigest(comp);

        expect(digest).toMatch(/^[0-9a-f]{64}$/);
        // 再次计算确认稳定
        const digestRecheck = await computeDigest(comp);
        expect(digest).toBe(digestRecheck);

        digests.set(preset.id, digest);
      }

      // 六个预设的摘要应当互不相同
      const uniqueDigests = new Set(digests.values());
      expect(uniqueDigests.size).toBe(PRESETS.length);
    });
  });

  describe('3. Worker 端请求处理与错误序列化 (handleWorkerRequest)', () => {
    it('处理合法 ANALYZE 请求：返回 RESULT 响应并包含 64 位 digest', async () => {
      const req: WorkerRequest = {
        kind: 'ANALYZE',
        runId: 101,
        input: PRESET_TF_B,
      };

      const resp = await handleWorkerRequest(req);
      expect(resp).not.toBeNull();
      expect(resp?.kind).toBe('RESULT');

      if (resp && resp.kind === 'RESULT') {
        expect(resp.runId).toBe(101);
        expect(resp.result.schema).toBe('timefold.result/1');
        expect(resp.result.digest).toMatch(/^[0-9a-f]{64}$/);
        expect(resp.result.occurrences.length).toBe(1);
        expect(resp.result.firstWitness.type).toBe('FOLD');
      }
    });

    it('处理非法输入抛出的 TimeFoldError：正确序列化 code, path, message 为 ERROR 响应', async () => {
      const invalidInput = {
        ...PRESET_TF_B,
        schedule: {
          ...PRESET_TF_B.schedule,
          startDate: '2026-99-99', // 非法日期
        },
      } as unknown as TimeFoldInput;

      const req: WorkerRequest = {
        kind: 'ANALYZE',
        runId: 202,
        input: invalidInput,
      };

      const resp = await handleWorkerRequest(req);
      expect(resp).not.toBeNull();
      expect(resp?.kind).toBe('ERROR');

      if (resp && resp.kind === 'ERROR') {
        expect(resp.runId).toBe(202);
        expect(typeof resp.code).toBe('string');
        expect(resp.code.length).toBeGreaterThan(0);
        expect(resp.path).toContain('schedule.startDate');
        expect(typeof resp.message).toBe('string');
      }
    });

    it('处理 CANCEL 请求：返回 null，不产生任何发往主线程的消息', async () => {
      const req: WorkerRequest = {
        kind: 'CANCEL',
        runId: 303,
      };

      const resp = await handleWorkerRequest(req);
      expect(resp).toBeNull();
    });

    it('处理未知/畸形请求：含合法 runId 时返回 E_INVALID_REQUEST 错误响应', async () => {
      const malformed = { kind: 'ANALYZE', runId: 404, input: null };
      const resp = await handleWorkerRequest(malformed);

      expect(resp).not.toBeNull();
      expect(resp?.kind).toBe('ERROR');
      if (resp && resp.kind === 'ERROR') {
        expect(resp.runId).toBe(404);
        expect(resp.code).toBe('E_INVALID_REQUEST');
      }
    });

    it('处理完全非法消息（无 runId）：直接返回 null', async () => {
      expect(await handleWorkerRequest(null)).toBeNull();
      expect(await handleWorkerRequest('random string')).toBeNull();
      expect(await handleWorkerRequest({ foo: 'bar' })).toBeNull();
    });
  });

  describe('4. 协议守卫 (isWorkerRequest / isWorkerResponse)', () => {
    it('isWorkerRequest 守卫准确识别合法与非法请求', () => {
      expect(isWorkerRequest({ kind: 'ANALYZE', runId: 1, input: PRESET_TF_A })).toBe(true);
      expect(isWorkerRequest({ kind: 'CANCEL', runId: 2 })).toBe(true);

      expect(isWorkerRequest(null)).toBe(false);
      expect(isWorkerRequest({})).toBe(false);
      expect(isWorkerRequest({ kind: 'ANALYZE' })).toBe(false);
      expect(isWorkerRequest({ kind: 'CANCEL', runId: 'invalid' })).toBe(false);
      expect(isWorkerRequest({ kind: 'UNKNOWN', runId: 1 })).toBe(false);
    });

    it('isWorkerResponse 守卫准确识别合法与非法响应', () => {
      const comp = analyze(PRESET_TF_A);
      const validResult: WorkerResultResponse = {
        kind: 'RESULT',
        runId: 1,
        result: { ...comp, digest: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
      };
      const validError: WorkerErrorResponse = {
        kind: 'ERROR',
        runId: 2,
        code: 'E_FAIL',
        path: 'schedule',
        message: 'Failed',
      };

      expect(isWorkerResponse(validResult)).toBe(true);
      expect(isWorkerResponse(validError)).toBe(true);

      expect(isWorkerResponse(null)).toBe(false);
      expect(isWorkerResponse({ kind: 'RESULT', runId: 1 })).toBe(false);
      expect(isWorkerResponse({ kind: 'ERROR', runId: 1, code: 'E' })).toBe(false);
    });
  });

  describe('5. TimeFoldClient 主线程状态调度与竞态防覆盖 (FR11)', () => {
    it('正常顺序计算：activeRunId 匹配，状态更新并记录 committedRunId', async () => {
      const channel = new MockWorkerChannel();
      const client = new TimeFoldClient(channel);

      const runId = client.dispatch(PRESET_TF_B);
      expect(runId).toBe(1);
      expect(client.getActiveRunId()).toBe(1);
      expect(client.getIsBusy()).toBe(true);
      expect(channel.sentRequests.length).toBe(1);
      expect(channel.sentRequests[0]?.kind).toBe('ANALYZE');

      // Worker 计算并回传结果
      const comp = analyze(PRESET_TF_B);
      const digest = await computeDigest(comp);
      const resp: WorkerResultResponse = {
        kind: 'RESULT',
        runId: 1,
        result: { ...comp, digest },
      };

      const accepted = client.onWorkerMessage(resp);
      expect(accepted).toBe(true);
      expect(client.getCommittedRunId()).toBe(1);
      expect(client.getIsBusy()).toBe(false);
      expect(client.getLatestResult()?.input.name).toBe('TF-B New York Fall Fold');
      expect(client.getLatestError()).toBeNull();
    });

    it('竞态防覆盖：runId=1 假迟到 RESULT 绝不覆盖已切换的 runId=2 状态', async () => {
      const channel = new MockWorkerChannel();
      const client = new TimeFoldClient(channel);

      // 1. 用户触发 TF-A 计算 (runId = 1)
      const runId1 = client.dispatch(PRESET_TF_A);
      expect(runId1).toBe(1);
      expect(client.getActiveRunId()).toBe(1);

      // 2. 在 runId=1 尚未返回时，用户迅速切换到 TF-B (runId = 2)
      const runId2 = client.dispatch(PRESET_TF_B);
      expect(runId2).toBe(2);
      expect(client.getActiveRunId()).toBe(2);

      // 3. runId=1 的计算结果迟到返回
      const compA = analyze(PRESET_TF_A);
      const lateResp1: WorkerResultResponse = {
        kind: 'RESULT',
        runId: 1,
        result: { ...compA, digest: 'sha256-dummy-1' },
      };
      const acceptedLate = client.onWorkerMessage(lateResp1);

      // 必须被严格拒收！
      expect(acceptedLate).toBe(false);
      expect(client.getCommittedRunId()).toBeNull();
      expect(client.getLatestResult()).toBeNull();
      expect(client.getActiveRunId()).toBe(2); // activeRunId 依然是 2

      // 4. runId=2 的结果正常返回
      const compB = analyze(PRESET_TF_B);
      const freshResp2: WorkerResultResponse = {
        kind: 'RESULT',
        runId: 2,
        result: { ...compB, digest: 'sha256-dummy-2' },
      };
      const acceptedFresh = client.onWorkerMessage(freshResp2);

      expect(acceptedFresh).toBe(true);
      expect(client.getCommittedRunId()).toBe(2);
      expect(client.getLatestResult()?.input.name).toBe('TF-B New York Fall Fold');
    });

    it('竞态防覆盖：迟到的 ERROR 响应绝不污染活跃状态', () => {
      const channel = new MockWorkerChannel();
      const client = new TimeFoldClient(channel);

      // 用户触发 runId=1，随后切到 runId=2
      client.dispatch(PRESET_TF_A);
      client.dispatch(PRESET_TF_B);
      expect(client.getActiveRunId()).toBe(2);

      // runId=1 发生异常并迟到返回
      const lateErrorResp: WorkerErrorResponse = {
        kind: 'ERROR',
        runId: 1,
        code: 'E_STALE_FAIL',
        path: '$',
        message: 'Stale calculation failed',
      };

      const accepted = client.onWorkerMessage(lateErrorResp);
      expect(accepted).toBe(false);
      expect(client.getLatestError()).toBeNull();
      expect(client.getCommittedRunId()).toBeNull();
      expect(client.getActiveRunId()).toBe(2);
    });

    it('逻辑取消：cancel() 立即屏蔽迟到数据并向 Worker 发送 CANCEL', async () => {
      const channel = new MockWorkerChannel();
      const client = new TimeFoldClient(channel);

      const runId = client.dispatch(PRESET_TF_A);
      expect(runId).toBe(1);
      expect(client.getActiveRunId()).toBe(1);
      expect(client.getIsBusy()).toBe(true);

      // 用户执行逻辑取消
      client.cancel();
      expect(client.getActiveRunId()).toBeNull();
      expect(client.getIsBusy()).toBe(false);

      // 确认 CANCEL 请求已投递至 Worker 通道
      expect(channel.sentRequests.length).toBe(2);
      expect(channel.sentRequests[1]).toEqual({ kind: 'CANCEL', runId: 1 });

      // 迟滞的 runId=1 结果到达
      const compA = analyze(PRESET_TF_A);
      const staleResp: WorkerResultResponse = {
        kind: 'RESULT',
        runId: 1,
        result: { ...compA, digest: 'sha256-dummy-stale' },
      };

      const accepted = client.onWorkerMessage(staleResp);
      expect(accepted).toBe(false);
      expect(client.getCommittedRunId()).toBeNull();
      expect(client.getLatestResult()).toBeNull();
    });

    it('订阅者模式 (subscribe)：准确接收每个状态快照', () => {
      const channel = new MockWorkerChannel();
      const client = new TimeFoldClient(channel);

      const states: ClientState[] = [];
      const unsubscribe = client.subscribe((s) => states.push({ ...s }));

      client.dispatch(PRESET_TF_A);
      client.cancel();

      unsubscribe();
      client.dispatch(PRESET_TF_B);

      // 验证收到的快照序列
      // 0: 初始状态 (activeRunId: null)
      // 1: dispatch 后 (activeRunId: 1, isBusy: true)
      // 2: cancel 后 (activeRunId: null, isBusy: false)
      expect(states.length).toBe(3);
      expect(states[0]?.activeRunId).toBeNull();
      expect(states[1]?.activeRunId).toBe(1);
      expect(states[1]?.isBusy).toBe(true);
      expect(states[2]?.activeRunId).toBeNull();
      expect(states[2]?.isBusy).toBe(false);
    });

    it('Promise 封装 analyze()：当前计算成功 resolve，被取消或覆盖时正确 reject', async () => {
      const channel = new MockWorkerChannel();
      const client = new TimeFoldClient(channel);

      // 1. 发起第一次 analyze
      const promise1 = client.analyze(PRESET_TF_A);

      // 2. 迅速发起第二次 analyze，此时第一次将被覆盖并 reject
      const promise2 = client.analyze(PRESET_TF_B);

      // 验证 promise1 因被覆盖而 reject
      await expect(promise1).rejects.toThrow('superseded');

      // 3. Worker 回传第二次的结果
      const compB = analyze(PRESET_TF_B);
      const digestB = await computeDigest(compB);
      channel.deliverWorkerResponse({
        kind: 'RESULT',
        runId: 2,
        result: { ...compB, digest: digestB },
      });

      const res2 = await promise2;
      expect(res2.input.name).toBe('TF-B New York Fall Fold');
    });

    it('Promise 封装 analyze()：Worker 返回 ERROR 时以 TimeFoldError 正确 reject', async () => {
      const channel = new MockWorkerChannel();
      const client = new TimeFoldClient(channel);

      const promise = client.analyze(PRESET_TF_C);

      channel.deliverWorkerResponse({
        kind: 'ERROR',
        runId: 1,
        code: 'E_DATE_OUT_OF_RANGE',
        path: 'schedule.startDate',
        message: 'Date out of range',
      });

      await expect(promise).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(TimeFoldError);
        const tfe = err as TimeFoldError;
        expect(tfe.code).toBe('E_DATE_OUT_OF_RANGE');
        expect(tfe.path).toBe('schedule.startDate');
        return true;
      });
    });

    it('端到端全链路模拟：Channel 连接真实 handleWorkerRequest', async () => {
      const channel = new MockWorkerChannel();
      const client = new TimeFoldClient(channel);

      // 劫持 postMessage 自动调用真实 handleWorkerRequest 并交付
      channel.postMessage = async (msg) => {
        channel.sentRequests.push(msg as WorkerRequest);
        await channel.processAndRespond(msg as WorkerRequest);
      };

      const result = await client.analyze(PRESET_TF_F);
      expect(result.schema).toBe('timefold.result/1');
      expect(result.occurrences.length).toBe(4);
      expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(client.getCommittedRunId()).toBe(1);
      expect(client.getIsBusy()).toBe(false);
    });
  });

  describe('6. 架构强约束：全仓代码检索唯一 Worker 实例化点', () => {
    it('源码中仅允许存在一个 Dedicated Worker 实例化创建点，绝不通过多 Worker 并行', () => {
      const rootDir = resolve(__dirname, '../../');
      const filesWithWorkerInstantiation: string[] = [];
      const pattern = ['new', ' Worker('].join('');

      function scanDir(dir: string): void {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (
            entry === 'node_modules' ||
            entry === 'dist' ||
            entry === '.git' ||
            entry === '.tmp' ||
            entry === 'evidence'
          ) {
            continue;
          }
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            scanDir(fullPath);
          } else if (
            entry.endsWith('.ts') ||
            entry.endsWith('.tsx') ||
            entry.endsWith('.js') ||
            entry.endsWith('.mjs')
          ) {
            const content = readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
              const line = lines[lineNum - 1]!;
              const trimmed = line.trim();
              if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
                continue;
              }
              // 忽略自身测试文件内的动态拼接字符串
              if (fullPath.includes('workerProtocol.test.ts')) {
                continue;
              }
              if (line.includes(pattern)) {
                filesWithWorkerInstantiation.push(
                  `${fullPath.replace(rootDir + '/', '')}:${lineNum}: ${trimmed}`
                );
              }
            }
          }
        }
      }

      scanDir(rootDir);

      // 验证全仓源码中仅有 client.ts 内部一处
      expect(filesWithWorkerInstantiation.length).toBe(1);
      expect(filesWithWorkerInstantiation[0]).toContain('src/worker/client.ts');
    });
  });
});
