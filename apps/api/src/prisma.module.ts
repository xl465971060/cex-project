import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/** 全局 Prisma:各业务模块免重复声明 */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
