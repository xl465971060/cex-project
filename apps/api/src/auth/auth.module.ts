import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RedisService } from "../redis.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { CodeService, RedisCodeStore } from "./code.service";
import { JwtGuard } from "./jwt.guard";
import { MailService } from "./mail.service";

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? "dev-secret-change-me",
      signOptions: { expiresIn: "7d" }
    })
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    MailService,
    JwtGuard,
    RedisService,
    {
      provide: RedisCodeStore,
      useFactory: (redis: RedisService) => new RedisCodeStore(redis.client),
      inject: [RedisService]
    },
    {
      provide: CodeService,
      useFactory: (store: RedisCodeStore) => new CodeService(store),
      inject: [RedisCodeStore]
    }
  ],
  // 导出 JwtModule(JwtGuard 依赖 JwtService,导出 provider 必须连带其依赖模块)
  exports: [JwtModule, JwtGuard]
})
export class AuthModule {}
