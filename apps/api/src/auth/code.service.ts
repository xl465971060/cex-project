import type Redis from "ioredis";
import { apiError } from "./errors";

/** 验证码存储抽象：生产用 Redis，单测用内存实现 */
export interface CodeStore {
  get(key: string): Promise<string | null>;
  setEx(key: string, value: string, ttlSec: number): Promise<void>;
  /** 自增；首次创建（返回 1）时设置过期 */
  incr(key: string, ttlSec: number): Promise<number>;
  /** 不存在才写入并设过期；false = 已存在 */
  setNxEx(key: string, ttlSec: number): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
}

export class RedisCodeStore implements CodeStore {
  constructor(private readonly redis: Redis) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }
  async setEx(key: string, value: string, ttlSec: number): Promise<void> {
    await this.redis.set(key, value, "EX", ttlSec);
  }
  async incr(key: string, ttlSec: number): Promise<number> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, ttlSec);
    return n;
  }
  async setNxEx(key: string, ttlSec: number): Promise<boolean> {
    const r = await this.redis.set(key, "1", "EX", ttlSec, "NX");
    return r === "OK";
  }
  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys);
  }
}

/** 验证码场景：reg=注册（流程图1.1） pw=重置密码（流程图1.3） */
export type CodeScene = "reg" | "pw";

export const CODE_TTL_SEC = 600; // 10 分钟有效（流程图 1.1）
export const RESEND_LOCK_SEC = 60; // 距上次发送 <60s 拒绝（情况3）
export const DAILY_LIMIT = 10; // 每日 ≥10 条拒绝（情况3）
export const ERR_LOCK_SEC = 1800; // 30 分钟内错 5 次锁定（情况2）
export const MAX_ERRORS = 5;

/**
 * 验证码服务：发送频控 + 有效期 + 错误锁定，全部分支对应流程图 1.1 的情况编号
 * 注册/重置密码共用同一套规则（流程图 1.3 注明「频控同注册」）
 */
export class CodeService {
  constructor(private readonly store: CodeStore) {}

  private key(scene: CodeScene, kind: string, id: string): string {
    return `vc:${scene}:${kind}:${id}`;
  }

  /** 发送验证码，返回明文码（调用方负责投递）。违反频控抛 CODE_TOO_FREQUENT / CODE_DAILY_LIMIT */
  async send(scene: CodeScene, id: string): Promise<string> {
    const sent = await this.store.setNxEx(this.key(scene, "lock60", id), RESEND_LOCK_SEC);
    if (!sent) apiError(429, "CODE_TOO_FREQUENT", "发送过于频繁，请 60 秒后再试");

    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await this.store.incr(this.key(scene, "day", `${id}:${day}`), 86400);
    if (count > DAILY_LIMIT) apiError(429, "CODE_DAILY_LIMIT", "今日验证码发送已达上限");

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.store.setEx(this.key(scene, "code", id), code, CODE_TTL_SEC);
    return code;
  }

  /** 校验验证码：成功则清除错误计数。失败抛 CODE_LOCKED / CODE_EXPIRED / CODE_WRONG */
  async verify(scene: CodeScene, id: string, code: string): Promise<void> {
    if (await this.store.get(this.key(scene, "errlock", id))) {
      apiError(423, "CODE_LOCKED", "错误次数过多，请 30 分钟后再试");
    }
    const saved = await this.store.get(this.key(scene, "code", id));
    if (!saved) apiError(400, "CODE_EXPIRED", "验证码已过期，请重新发送");
    if (saved !== code) {
      const errors = await this.store.incr(this.key(scene, "err", id), ERR_LOCK_SEC);
      if (errors >= MAX_ERRORS) {
        await this.store.setNxEx(this.key(scene, "errlock", id), ERR_LOCK_SEC);
        apiError(423, "CODE_LOCKED", "错误次数过多，请 30 分钟后再试");
      }
      apiError(400, "CODE_WRONG", "验证码错误");
    }
    await this.store.del(this.key(scene, "err", id), this.key(scene, "code", id));
  }
}
