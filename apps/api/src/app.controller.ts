import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  /** 健康检查（验证用：curl http://localhost:4000/health） */
  @Get("health")
  health(): { service: string; status: string; time: string } {
    return { service: "api", status: "ok", time: new Date().toISOString() };
  }

  /** 可交易对列表（验证数据库链路：需先完成 db migrate 且 MySQL 容器在运行） */
  @Get("pairs")
  async pairs(): Promise<unknown> {
    return this.prisma.pairConfig.findMany({ where: { tradingEnabled: true } });
  }
}
