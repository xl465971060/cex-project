import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgerController } from "./ledger.controller";
import { LedgerService } from "./ledger.service";
import { AdminGuard } from "./admin.guard";

@Module({
  // PrismaService 来自全局 PrismaModule；JwtGuard 来自 AuthModule（/assets 复用用户鉴权）
  imports: [AuthModule],
  controllers: [LedgerController],
  providers: [LedgerService, AdminGuard],
  exports: [LedgerService] // T5 撮合记账 / T7 充值 / T8 提现直接注入复用
})
export class LedgerModule {}
