import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma.service";
import { apiError } from "./errors";

/** Bearer JWT 鉴权:验签 + tokenVersion 比对,通过后 req.user = { uid } */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers?.authorization ?? "";
    if (!header.startsWith("Bearer ")) apiError(401, "UNAUTHORIZED", "未登录");
    const token = header.slice(7);

    let payload: { sub?: string; ver?: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      apiError(401, "SESSION_EXPIRED", "登录已失效,请重新登录");
    }
    if (!payload?.sub) apiError(401, "SESSION_EXPIRED", "登录已失效,请重新登录");

    const sec = await this.prisma.userSecurity.findUnique({ where: { uid: payload.sub } });
    if (!sec || sec.tokenVersion !== payload.ver) {
      // 改密/重置后旧 token 走这里全端失效
      apiError(401, "SESSION_EXPIRED", "登录已失效,请重新登录");
    }
    req.user = { uid: payload.sub };
    return true;
  }
}
