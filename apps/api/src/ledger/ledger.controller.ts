import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from "@nestjs/common";
import { COIN_DECIMALS, toCoinBaseUnits, ledgerOpSchema, ledgerReverseSchema } from "@cex/shared";
import { JwtGuard } from "../auth/jwt.guard";
import { apiError } from "../auth/errors";
import { parseOrThrow } from "../zod.util";
import { LedgerService } from "./ledger.service";
import { AdminGuard } from "./admin.guard";

/**
 * 账务统一入口的 HTTP 面：
 * - GET  /assets         用户查自己资产（JWT）
 * - POST /ledger/ops     管理端四操作 credit/debit/freeze/unfreeze（AdminGuard）
 * - POST /ledger/reverse 管理端差错冲正（AdminGuard）
 * - GET  /ledger/flows   管理端流水查询（AdminGuard）
 * 后续撮合成交（T5）、充值（T7）、提现（T8）都调 LedgerService 方法，不走 HTTP。
 */
@Controller()
export class LedgerController {
  constructor(private ledger: LedgerService) {}

  /** 我的资产列表（两级余额 + 十进制展示串） */
  @Get("assets")
  @UseGuards(JwtGuard)
  async assets(@Req() req: { user: { uid: string } }) {
    return { assets: await this.ledger.assetsOf(req.user.uid) };
  }

  /** 管理端记账：幂等单号必填，重放返回原流水（HTTP 幂等友好） */
  @Post("ledger/ops")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async op(@Body() body: unknown) {
    const input = parseOrThrow(ledgerOpSchema, body);
    const flow = await this.ledger.apply({
      uid: input.uid,
      coin: input.coin,
      bizNo: input.bizNo,
      type: input.op,
      amount: this.toAmount(input.amount, input.coin),
      fromFrozen: input.fromFrozen,
      ref: input.ref
    });
    return { flow };
  }

  /** 差错冲正：对原流水生成反向流水，原流水不可变 */
  @Post("ledger/reverse")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async reverse(@Body() body: unknown) {
    const input = parseOrThrow(ledgerReverseSchema, body);
    return { flow: await this.ledger.reverse(input.originalBizNo, input.newBizNo, input.reason) };
  }

  /** 管理端查某用户流水（差错排查） */
  @Get("ledger/flows")
  @UseGuards(AdminGuard)
  async flows(@Query("uid") uid: string, @Query("coin") coin?: string) {
    if (!uid) throw apiError(400, "VALIDATION", "uid 必填");
    return { flows: await this.ledger.flowsOf(uid, coin || undefined) };
  }

  /** 十进制金额 → 最小单位。未知币种 / 精度超限都在这里挡下（400） */
  private toAmount(amountText: string, coin: string): bigint {
    if (COIN_DECIMALS[coin] === undefined) {
      throw apiError(400, "UNKNOWN_COIN", `未配置的币种: ${coin}`);
    }
    try {
      return toCoinBaseUnits(amountText, coin);
    } catch (e) {
      throw apiError(400, "INVALID_AMOUNT", (e as Error).message);
    }
  }
}
