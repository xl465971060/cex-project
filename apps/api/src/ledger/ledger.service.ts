import { Injectable } from "@nestjs/common";
import { Prisma } from "@cex/db";
import { PrismaService } from "../prisma.service";
import { apiError } from "../auth/errors";
import { formatCoinBaseUnits } from "@cex/shared";

/** 账务流水类型（对应流程图 5.1 的五操作；REVERSAL 为差错冲正） */
export type FlowType = "CREDIT" | "DEBIT" | "FREEZE" | "UNFREEZE" | "REVERSAL";

/** 对 apply/reverse 的统一输入；金额一律最小单位 bigint（资金红线） */
export interface LedgerOpInput {
  uid: string;
  coin: string;
  bizNo: string;
  type: Exclude<FlowType, "REVERSAL">;
  amount: bigint;
  /** 仅 DEBIT：从冻结余额扣（提现打款成功），否则从可用扣 */
  fromFrozen?: boolean;
  /** 关联业务单号：充值txid / 订单id / 提现单号 */
  ref?: string | null;
}

/** 流水对外的可 JSON 形态（BigInt → string，资金红线：JSON 不走 number） */
export interface FlowDTO {
  id: string;
  uid: string;
  coin: string;
  bizNo: string;
  type: string;
  availDelta: string;
  frozenDelta: string;
  availBefore: string;
  availAfter: string;
  frozenBefore: string;
  frozenAfter: string;
  ref: string | null;
  createdAt: Date;
}

export interface AssetDTO {
  coin: string;
  available: string;
  frozen: string;
  /** 十进制展示串，前端直接用 */
  availableText: string;
  frozenText: string;
  updatedAt: Date;
}

type AssetRow = { available: bigint; frozen: bigint };

/** 只暴露测试/内部需要的最小事务面，便于替换 Fake */
export interface LedgerTx {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  asset: {
    create(args: { data: { uid: string; coin: string; available: bigint; frozen: bigint } }): Promise<unknown>;
    update(args: {
      where: { uid_coin: { uid: string; coin: string } };
      data: { available: bigint; frozen: bigint };
    }): Promise<unknown>;
  };
  assetFlow: {
    findUnique(args: { where: { bizNo: string } }): Promise<FlowRow | null>;
    create(args: { data: FlowCreateData }): Promise<FlowRow>;
  };
}

export type FlowRow = {
  id: string;
  uid: string;
  coin: string;
  bizNo: string;
  type: string;
  availDelta: bigint;
  frozenDelta: bigint;
  availBefore: bigint;
  availAfter: bigint;
  frozenBefore: bigint;
  frozenAfter: bigint;
  ref: string | null;
  createdAt: Date;
};

export type FlowCreateData = Omit<FlowRow, "id">;

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  /**
   * 账务统一入口（流程图 5.1）：幂等 → 余额校验 → 原子变更 → 不可变流水。
   * 同 bizNo 重放：直接返回原流水，不重复记账。
   */
  async apply(input: LedgerOpInput): Promise<FlowDTO> {
    this.assertInput(input);
    const { availDelta, frozenDelta } = deltasOf(input.type, input.amount, input.fromFrozen);
    const flow = await this.transact({
      uid: input.uid,
      coin: input.coin,
      bizNo: input.bizNo,
      type: input.type,
      availDelta,
      frozenDelta,
      ref: input.ref ?? null
    });
    return this.toDTO(flow);
  }

  /**
   * 差错冲正：按原流水生成一笔完全反向的 REVERSAL 流水。
   * 原流水任何字段都不修改——差错只增不改（流程图 5.1 末分支）。
   */
  async reverse(originalBizNo: string, newBizNo: string, reason?: string): Promise<FlowDTO> {
    const original = await this.prisma.assetFlow.findUnique({ where: { bizNo: originalBizNo } });
    if (!original) {
      throw apiError(404, "ORIGINAL_FLOW_NOT_FOUND", `原流水不存在: ${originalBizNo}`);
    }
    const flow = await this.transact({
      uid: original.uid,
      coin: original.coin,
      bizNo: newBizNo,
      type: "REVERSAL",
      // 完全镜像：可用/冻结的变化量取反，快照按当前余额重新记录
      availDelta: -original.availDelta,
      frozenDelta: -original.frozenDelta,
      ref: reason ? `${originalBizNo}:${reason}` : originalBizNo
    });
    return this.toDTO(flow);
  }

  /** 用户资产列表（两级余额，附人类可读的十进制串） */
  async assetsOf(uid: string): Promise<AssetDTO[]> {
    const rows = await this.prisma.asset.findMany({ where: { uid }, orderBy: { coin: "asc" } });
    return rows.map((r) => ({
      coin: r.coin,
      available: r.available.toString(),
      frozen: r.frozen.toString(),
      availableText: formatCoinBaseUnits(r.available, r.coin),
      frozenText: formatCoinBaseUnits(r.frozen, r.coin),
      updatedAt: r.updatedAt
    }));
  }

  /** 流水查询（差错排查用，默认最近 50 条） */
  async flowsOf(uid: string, coin?: string, take = 50): Promise<FlowDTO[]> {
    const rows = await this.prisma.assetFlow.findMany({
      where: { uid, ...(coin ? { coin } : {}) },
      orderBy: { createdAt: "desc" },
      take
    });
    return rows.map((f) => this.toDTO(f));
  }

  /* ───────────────────────── 核心：单事务内 幂等→锁→校验→落账 ───────────────────────── */

  private async transact(p: {
    uid: string;
    coin: string;
    bizNo: string;
    type: FlowType;
    availDelta: bigint;
    frozenDelta: bigint;
    ref: string | null;
  }): Promise<FlowRow> {
    // 事务外保证账户行存在：事务内就只剩「锁一行 → 校验 → 更新 → 插流水」单一锁点，
    // 热点账户并发在此串行排队，互不持锁等待，无从成环（死锁的结构性消除）。
    await this.ensureAsset(p.uid, p.coin);
    // 幂等兜底：极端竞态下两个事务同时过①，UNIQUE(bizNo) 让后者插入失败；
    // 失败方重试，必然命中①直接返回原流水（有限次，防异常死循环）。
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // ① 幂等：同单号已入账 → 返回原结果，不重复记账
          const existing = await tx.assetFlow.findUnique({ where: { bizNo: p.bizNo } });
          if (existing) return existing;

          // ② 行锁加载账户（SELECT ... FOR UPDATE），所有并发在这里排队
          const asset = await this.loadForUpdate(tx, p.uid, p.coin);

          // ③ 余额校验：两级余额任何一侧不允许为负
          const availAfter = asset.available + p.availDelta;
          const frozenAfter = asset.frozen + p.frozenDelta;
          if (availAfter < 0n) {
            throw apiError(
              422,
              "INSUFFICIENT_BALANCE",
              `可用余额不足：当前 ${asset.available}，需变动 ${p.availDelta}（${p.uid}/${p.coin}）`
            );
          }
          if (frozenAfter < 0n) {
            throw apiError(
              422,
              "INSUFFICIENT_FROZEN",
              `冻结余额不足：当前 ${asset.frozen}，需变动 ${p.frozenDelta}（${p.uid}/${p.coin}）`
            );
          }

          // ④ 原子变更两级余额
          await tx.asset.update({
            where: { uid_coin: { uid: p.uid, coin: p.coin } },
            data: { available: availAfter, frozen: frozenAfter }
          });

          // ⑤ 写入不可变流水（方向/类型/单号/双级余额快照）
          return tx.assetFlow.create({
            data: {
              uid: p.uid,
              coin: p.coin,
              bizNo: p.bizNo,
              type: p.type,
              availDelta: p.availDelta,
              frozenDelta: p.frozenDelta,
              availBefore: asset.available,
              availAfter,
              frozenBefore: asset.frozen,
              frozenAfter,
              ref: p.ref
            }
          });
        });
      } catch (e) {
        // 可重试：P2002 单号撞车 / P2034 引擎层死锁 / P2010(meta.code=1213) raw SQL 死锁。
        // 三种都安全——重试后 ① 会命中幂等分支直接返回原流水。
        const err = e as Prisma.PrismaClientKnownRequestError;
        const retryable =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          (err.code === "P2002" ||
            err.code === "P2034" ||
            (err.code === "P2010" && String(err.meta?.code ?? "") === "1213"));
        if (!retryable || attempt === 2) {
          throw e;
        }
      }
    }
    throw apiError(409, "LEDGER_BUSY", `单号并发竞争重试仍失败: ${p.bizNo}`);
  }

  /** 事务外建户（幂等，尽力而为）：失败不阻断，事务内 create 兜底 */
  private async ensureAsset(uid: string, coin: string): Promise<void> {
    try {
      await this.prisma.asset.upsert({
        where: { uid_coin: { uid, coin } },
        create: { uid, coin, available: 0n, frozen: 0n },
        update: {}
      });
    } catch {
      // 并发 upsert 竞态等场景交给事务内 create 路径，这里吞掉即可
    }
  }

  /**
   * 行锁加载账户（行由 ensureAsset 保证存在；万一没有则事务内补建后重锁）。
   * 红线：SELECT FOR UPDATE 打在不存在的行上会拿 gap lock，gap lock 互相兼容，
   * 并发首建会集体死锁——所以建行永远放在锁行之前。
   */
  private async loadForUpdate(tx: LedgerTx, uid: string, coin: string): Promise<AssetRow> {
    let rows = await tx.$queryRaw<AssetRow[]>`
      SELECT available, frozen FROM Asset WHERE uid = ${uid} AND coin = ${coin} FOR UPDATE`;
    if (rows.length === 0) {
      try {
        await tx.asset.create({ data: { uid, coin, available: 0n, frozen: 0n } });
      } catch (e) {
        // 并发补建：另一方先插了——忽略唯一键冲突
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      }
      rows = await tx.$queryRaw<AssetRow[]>`
        SELECT available, frozen FROM Asset WHERE uid = ${uid} AND coin = ${coin} FOR UPDATE`;
    }
    return rows[0]!;
  }

  private assertInput(input: LedgerOpInput): void {
    if (input.amount <= 0n) {
      throw apiError(400, "INVALID_AMOUNT", `金额必须为正的最小单位，收到 ${input.amount}`);
    }
    if (input.fromFrozen && input.type !== "DEBIT") {
      throw apiError(400, "INVALID_AMOUNT", "fromFrozen 仅对 DEBIT 有效");
    }
  }

  private toDTO(f: FlowRow): FlowDTO {
    return {
      id: f.id,
      uid: f.uid,
      coin: f.coin,
      bizNo: f.bizNo,
      type: f.type,
      availDelta: f.availDelta.toString(),
      frozenDelta: f.frozenDelta.toString(),
      availBefore: f.availBefore.toString(),
      availAfter: f.availAfter.toString(),
      frozenBefore: f.frozenBefore.toString(),
      frozenAfter: f.frozenAfter.toString(),
      ref: f.ref,
      createdAt: f.createdAt
    };
  }
}

/** 各操作对两级余额的净变化（带符号）——五操作统一成这两个数字 */
export function deltasOf(
  type: Exclude<FlowType, "REVERSAL">,
  amount: bigint,
  fromFrozen?: boolean
): { availDelta: bigint; frozenDelta: bigint } {
  switch (type) {
    case "CREDIT":
      return { availDelta: amount, frozenDelta: 0n };
    case "DEBIT":
      return fromFrozen ? { availDelta: 0n, frozenDelta: -amount } : { availDelta: -amount, frozenDelta: 0n };
    case "FREEZE": // 可用 → 冻结，总额不变
      return { availDelta: -amount, frozenDelta: amount };
    case "UNFREEZE": // 冻结 → 可用，总额不变
      return { availDelta: amount, frozenDelta: -amount };
  }
}
