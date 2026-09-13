import "dotenv/config"; // monorepo 根 .env（骨架期统一入口，后续换 @nestjs/config）
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { SERVICE_PORTS } from "@cex/shared";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // 允许 web/admin 前端跨域调用（骨架期放开，生产收敛白名单）
  const port = Number(process.env.API_PORT ?? SERVICE_PORTS.API);
  await app.listen(port);
  console.log(`[api] listening on http://localhost:${port}`);
}

void bootstrap();
