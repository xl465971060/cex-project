import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

/** Redis 单例客户端：验证码/频控/锁定（M1-T2），后续 BullMQ 队列复用 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 2,
      // 进程退出时自动断开，避免挂起
      lazyConnect: false
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
