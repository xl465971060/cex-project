import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { LedgerModule } from "./ledger/ledger.module";
import { PrismaModule } from "./prisma.module";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, LedgerModule],
  controllers: [AppController]
})
export class AppModule {}
