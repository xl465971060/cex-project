import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { apiError } from "../auth/errors";

/**
 * 内部管理接口门卫（M1 决策：Admin 走 API + 超管令牌，M2 再做独立 Admin 前端）。
 * 请求头 x-admin-token 必须等于服务端 ADMIN_TOKEN；生产必须换强随机值。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const token: unknown = req.headers?.["x-admin-token"];
    const expected = process.env.ADMIN_TOKEN ?? "dev-admin-token";
    if (typeof token !== "string" || token.length === 0 || token !== expected) {
      apiError(401, "ADMIN_REQUIRED", "缺少或错误的管理员令牌 x-admin-token");
    }
    return true;
  }
}
