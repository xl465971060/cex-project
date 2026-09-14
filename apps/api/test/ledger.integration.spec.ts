/**
 * M1-T1 账务 L2 集成测试:真实 MySQL,验证并发正确性(线路图验收 L2)。
 * 运行方式(RUN_DB_TESTS=1 门控,默认跳过,CI 单测任务不依赖 MySQL):
 *   cd apps/api && RUN_DB_TESTS=1 pnpm exec dotenv -e ../../.env -- pnpm exec vitest run test/ledger.integration.spec.ts
 * 前置:cex-mysql 健康,且迁移已应用(pnpm --filter @cex/db exec prisma migrate deploy)。
 * 隔离:每个用例独立 uid,断言精确余额不受其他用例影响。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaService } from "../src/prisma.service";
import { LedgerService } from "../src/ledger/ledger.service";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;
const COIN = "USDT";
const RUN_PREFIX = `it-l2-${Date.now()}`;

d("M1-T1 账务 L2:真实 MySQL 并发", () => {
  const prisma = new PrismaService();
  const svc = new LedgerService(prisma);
  /** 每用例独立账户,杜绝串账 */
  let UID: string;
  const freshUid = () => `${RUN_PREFIX}-${Math.random().toString(36).slice(2, 8)}`;

  const balance = async (uid: string) => {
    const row = await prisma.asset.findUnique({ where: { uid_coin: { uid, coin: COIN } } });
    return { available: row?.available ?? 0n, frozen: row?.frozen ?? 0n };
  };

  beforeAll(async () => {
    await prisma.assetFlow.deleteMany({ where: { uid: { startsWith: "it-l2-" } } });
    await prisma.asset.deleteMany({ where: { uid: { startsWith: "it-l2-" } } });
  });

  afterAll(async () => {
    await prisma.assetFlow.deleteMany({ where: { uid: { startsWith: "it-l2-" } } });
    await prisma.asset.deleteMany({ where: { uid: { startsWith: "it-l2-" } } });
    await prisma.$disconnect();
  });

  it("20 线程并发打款同 UID(不同单号):最终余额精确,流水 20 条,单号无重复", async () => {
    UID = freshUid();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        svc.apply({ uid: UID, coin: COIN, bizNo: `pay-${RUN_PREFIX}-${i}`, type: "CREDIT", amount: 100000000n })
      )
    );
    expect(results).toHaveLength(20);
    expect((await balance(UID)).available).toBe(2000000000n); // 20 × 100 USDT,分毫不差

    const flows = await prisma.assetFlow.findMany({ where: { uid: UID, type: "CREDIT" } });
    expect(flows).toHaveLength(20);
    expect(new Set(flows.map((f) => f.bizNo)).size).toBe(20); // bizNo 无重复
    // 对账恒等式:SUM(availDelta) == Asset.available
    expect(flows.reduce((acc, f) => acc + f.availDelta, 0n)).toBe(2000000000n);
  }, 30_000);

  it("20 线程并发重放同一单号:只记一笔,余额只加一次,全部返回原流水", async () => {
    UID = freshUid();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        svc.apply({ uid: UID, coin: COIN, bizNo: `dup-${RUN_PREFIX}`, type: "CREDIT", amount: 5000000n })
      )
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1); // 全部返回同一笔原流水
    expect(await prisma.assetFlow.findMany({ where: { bizNo: `dup-${RUN_PREFIX}` } })).toHaveLength(1);
    expect((await balance(UID)).available).toBe(5000000n); // 只加一次
  }, 30_000);

  it("20 线程抢冻结(余额只够 8 笔):恰好 8 成 12 拒,两级余额精确", async () => {
    UID = freshUid();
    // 冲 250 USDT;20 个线程各抢冻 30 → 只有 8 笔能成(8×30=240,余 10 不够)
    await svc.apply({ uid: UID, coin: COIN, bizNo: `seed-${RUN_PREFIX}`, type: "CREDIT", amount: 250000000n });

    const settled = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        svc.apply({ uid: UID, coin: COIN, bizNo: `frz-${RUN_PREFIX}-${i}`, type: "FREEZE", amount: 30000000n })
      )
    );
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(8); // 行锁串行化后恰好放行 8 笔
    expect(settled.filter((r) => r.status === "rejected")).toHaveLength(12);
    expect(await balance(UID)).toEqual({ available: 10000000n, frozen: 240000000n }); // 总额守恒 250
  }, 30_000);

  it("冲正:对入账冲正后余额精确回退,原流水不可变", async () => {
    UID = freshUid();
    const original = await svc.apply({
      uid: UID, coin: COIN, bizNo: `pay-${RUN_PREFIX}-r`, type: "CREDIT", amount: 100000000n
    });
    const rev = await svc.reverse(`pay-${RUN_PREFIX}-r`, `rev-${RUN_PREFIX}`, "L2 验证冲正");
    expect(rev.type).toBe("REVERSAL");
    expect(rev.availDelta).toBe("-100000000");
    expect(await balance(UID)).toEqual({ available: 0n, frozen: 0n });
    // 原流水未被修改
    const row = await prisma.assetFlow.findUnique({ where: { bizNo: `pay-${RUN_PREFIX}-r` } });
    expect(row && original.availAfter === row.availAfter.toString()).toBe(true);
  }, 30_000);
});

// 默认跳过时给出提示,避免"以为跑了其实没跑"
if (!RUN) {
  describe("M1-T1 L2 集成测试", () => {
    it("跳过(未设置 RUN_DB_TESTS=1,不连真实 MySQL)", () => {
      expect(true).toBe(true);
    });
  });
}
