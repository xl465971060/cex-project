/**
 * M1-T1 账务 L1 单测:内存 Fake 事务跑通流程图 5.1 全部分支。
 * 覆盖线路图验收:
 *   ① 幂等单号重复 → 返回原结果不重复记账
 *   ② 余额不足 → 拒绝且无任何写入(事务回滚)
 *   ③ 冻结 → 可用减冻结增总额不变
 *   ④ 冲正 → 生成反向流水且原流水不可变
 * 不依赖 MySQL —— 并发正确性由 L2(真实 MySQL)与 L3(verify 脚本)覆盖。
 */
import { describe, expect, it } from "vitest";
import { Prisma } from "@cex/db";
import type { HttpException } from "@nestjs/common";
import { LedgerService, type LedgerTx, type FlowRow } from "../src/ledger/ledger.service";
import type { PrismaService } from "../src/prisma.service";

const UID = "u-ledger";
const COIN = "USDT";

async function errOf(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await p;
  } catch (e) {
    const ex = e as HttpException;
    return { status: ex.getStatus(), code: (ex.getResponse() as { code: string }).code };
  }
  throw new Error("预期抛出业务异常,但没有");
}

/** 内存版账务存储:$transaction 抛错即回滚到事务前快照(模拟 DB 原子性) */
class FakeLedgerStore {
  assets = new Map<string, { available: bigint; frozen: bigint }>(); // key: uid|coin
  flows = new Map<string, FlowRow>(); // key: bizNo(模拟 UNIQUE)
  private seq = 0;

  makeTx(): LedgerTx {
    return {
      $queryRaw: async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join("?");
        if (!sql.includes("FOR UPDATE")) throw new Error("fake 只支持 FOR UPDATE 行锁查询");
        const [uid, coin] = values as [string, string];
        const row = this.assets.get(`${uid}|${coin}`);
        return (row ? [{ available: row.available, frozen: row.frozen }] : []) as T;
      },
      asset: {
        create: async ({ data }) => {
          const key = `${data.uid}|${data.coin}`;
          if (this.assets.has(key)) throw this.dup();
          this.assets.set(key, { available: data.available, frozen: data.frozen });
          return data;
        },
        update: async ({ where, data }) => {
          const key = `${where.uid_coin.uid}|${where.uid_coin.coin}`;
          const row = this.assets.get(key);
          if (!row) throw new Error("fake: update 不存在的 Asset");
          row.available = data.available;
          row.frozen = data.frozen;
          return row;
        }
      },
      assetFlow: {
        findUnique: async ({ where }) => this.flows.get(where.bizNo) ?? null,
        create: async ({ data }) => {
          if (this.flows.has(data.bizNo)) throw this.dup();
          const row = { id: `f${++this.seq}`, ...data } as FlowRow;
          this.flows.set(data.bizNo, row);
          return row;
        }
      }
    };
  }

  /** 模拟 PrismaService.$transaction:抛错回滚(快照恢复),成功提交 */
  async $transaction(fn: (tx: LedgerTx) => Promise<FlowRow>): Promise<FlowRow> {
    const snapAssets = structuredClone(this.assets);
    const snapFlows = structuredClone(this.flows);
    try {
      return await fn(this.makeTx());
    } catch (e) {
      this.assets = snapAssets;
      this.flows = snapFlows;
      throw e;
    }
  }

  /** 业务侧读路径:reverse 用 prisma.assetFlow.findUnique(事务外) */
  get assetFlow() {
    return {
      findUnique: async ({ where }: { where: { bizNo: string } }) => this.flows.get(where.bizNo) ?? null
    };
  }

  get asset() {
    return {
      findMany: async ({ where }: { where: { uid: string } }) =>
        [...this.assets.entries()]
          .filter(([k]) => k.startsWith(`${where.uid}|`))
          .map(([k, v]) => ({
            uid: where.uid,
            coin: k.split("|")[1],
            available: v.available,
            frozen: v.frozen,
            updatedAt: new Date()
          }))
          .sort((a, b) => a.coin.localeCompare(b.coin))
    };
  }

  private dup(): Error {
    return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "fake"
    });
  }
}

function build() {
  const store = new FakeLedgerStore();
  const svc = new LedgerService(store as unknown as PrismaService);
  return { store, svc };
}

const bal = (store: FakeLedgerStore, uid = UID) =>
  store.assets.get(`${uid}|${COIN}`) ?? { available: 0n, frozen: 0n };

describe("M1-T1 账务统一入口(流程图 5.1)", () => {
  it("CREDIT 首笔自动建 0 户再入账,流水带完整快照", async () => {
    const { svc } = build();
    const f = await svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 100000000n });
    expect(f.type).toBe("CREDIT");
    expect(f.availBefore).toBe("0");
    expect(f.availAfter).toBe("100000000");
    expect(f.frozenBefore).toBe("0");
    expect(f.frozenAfter).toBe("0");
  });

  it("① 幂等:同 bizNo 重放返回原流水,不重复记账", async () => {
    const { svc, store } = build();
    const first = await svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 100000000n });
    const replay = await svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 100000000n });
    expect(replay.id).toBe(first.id); // 返回原结果
    expect(bal(store).available).toBe(100000000n); // 只记了一次
    expect(store.flows.size).toBe(1);
  });

  it("① 幂等:重放参数与首次不同也返回原流水(证明未按新参数记账)", async () => {
    const { svc, store } = build();
    const first = await svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 100000000n });
    const replay = await svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 999n });
    expect(replay.id).toBe(first.id);
    expect(bal(store).available).toBe(100000000n);
  });

  it("② 余额不足:DEBIT 拒绝(422)且无任何写入", async () => {
    const { svc, store } = build();
    const e = await errOf(
      svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "DEBIT", amount: 1n })
    );
    expect(e).toEqual({ status: 422, code: "INSUFFICIENT_BALANCE" });
    expect(store.flows.size).toBe(0); // 无流水
    expect(store.assets.has(`${UID}|${COIN}`)).toBe(false); // 账户也没被建出来
  });

  it("③ 冻结:可用减冻结增,总额不变,快照正确", async () => {
    const { svc, store } = build();
    await svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 100000000n });
    const f = await svc.apply({ uid: UID, coin: COIN, bizNo: "B2", type: "FREEZE", amount: 30000000n });
    expect(bal(store)).toEqual({ available: 70000000n, frozen: 30000000n }); // 总额仍 100
    expect(f.availDelta).toBe("-30000000");
    expect(f.frozenDelta).toBe("30000000");
    expect(f.availBefore).toBe("100000000");
    expect(f.frozenAfter).toBe("30000000");
  });

  it("解冻超出冻结余额 → 422 INSUFFICIENT_FROZEN", async () => {
    const { svc, store } = build();
    await svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 100000000n });
    const e = await errOf(
      svc.apply({ uid: UID, coin: COIN, bizNo: "B2", type: "UNFREEZE", amount: 999n })
    );
    expect(e).toEqual({ status: 422, code: "INSUFFICIENT_FROZEN" });
    expect(bal(store).frozen).toBe(0n);
  });

  it("DEBIT.fromFrozen:从冻结扣(提现打款),可用不变", async () => {
    const { svc, store } = build();
    await svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 100000000n });
    await svc.apply({ uid: UID, coin: COIN, bizNo: "B2", type: "FREEZE", amount: 30000000n });
    const f = await svc.apply({
      uid: UID, coin: COIN, bizNo: "B3", type: "DEBIT", amount: 20000000n, fromFrozen: true, ref: "wd_1"
    });
    expect(bal(store)).toEqual({ available: 70000000n, frozen: 10000000n });
    expect(f.availDelta).toBe("0");
    expect(f.frozenDelta).toBe("-20000000");
    expect(f.ref).toBe("wd_1");
  });

  it("④ 冲正:生成完全反向的 REVERSAL 流水,原流水逐字段不可变", async () => {
    const { svc, store } = build();
    const original = await svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 100000000n });
    const before = structuredClone(store.flows.get("B1")); // 冲正前的原流水快照

    const rev = await svc.reverse("B1", "R1", "录错金额");
    expect(rev.type).toBe("REVERSAL");
    expect(rev.availDelta).toBe("-100000000"); // 精确取反
    expect(rev.frozenDelta).toBe("0");
    expect(rev.availAfter).toBe("0");
    expect(rev.ref).toBe("B1:录错金额");

    // 原流水不可变:所有字段与冲正前一致
    expect(store.flows.get("B1")).toEqual(before);
    expect(store.flows.get("B1")).not.toBe(original); // 且是库里那份,不是内存引用
  });

  it("冲正不存在原流水 → 404 ORIGINAL_FLOW_NOT_FOUND", async () => {
    const { svc } = build();
    const e = await errOf(svc.reverse("NOPE", "R1"));
    expect(e).toEqual({ status: 404, code: "ORIGINAL_FLOW_NOT_FOUND" });
  });

  it("冲正后余额会穿负 → 422 拒绝(差错不能把账改负)", async () => {
    const { svc } = build();
    await svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 100000000n });
    await svc.apply({ uid: UID, coin: COIN, bizNo: "B2", type: "DEBIT", amount: 100000000n }); // 清零
    const e = await errOf(svc.reverse("B1", "R1")); // 冲正入账会扣 100,但余额 0
    expect(e).toEqual({ status: 422, code: "INSUFFICIENT_BALANCE" });
  });

  it("非法输入:金额 0 / fromFrozen 用在非 DEBIT 上 → 400", async () => {
    const { svc } = build();
    expect(await errOf(svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 0n }))).toEqual({
      status: 400,
      code: "INVALID_AMOUNT"
    });
    expect(
      await errOf(svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 1n, fromFrozen: true }))
    ).toEqual({ status: 400, code: "INVALID_AMOUNT" });
  });

  it("assetsOf:两级余额 + 十进制展示串(1.5 USDT)", async () => {
    const { svc } = build();
    await svc.apply({ uid: UID, coin: COIN, bizNo: "B1", type: "CREDIT", amount: 1500000n });
    const assets = await svc.assetsOf(UID);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      coin: "USDT",
      available: "1500000",
      frozen: "0",
      availableText: "1.5",
      frozenText: "0"
    });
  });
});
