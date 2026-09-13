import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthService, type RequestMeta } from "./auth.service";
import { JwtGuard } from "./jwt.guard";

function metaOf(req: Request): RequestMeta {
  return {
    // 反代后真实 IP 在 x-forwarded-for 首段
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? null,
    userAgent: (req.headers["user-agent"] as string) ?? null,
    region: (req.headers["x-client-region"] as string) ?? null
  };
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 1.1 阶段一:注册校验 + 发验证码 */
  @Post("register/init")
  registerInit(@Body() body: unknown, @Req() req: Request) {
    return this.auth.registerInit(body, metaOf(req));
  }

  /** 1.1 阶段二:验证码确认建号 */
  @Post("register/confirm")
  registerConfirm(@Body() body: unknown) {
    return this.auth.registerConfirm(body);
  }

  @HttpCode(200)
  @Post("login")
  login(@Body() body: unknown, @Req() req: Request) {
    return this.auth.login(body, metaOf(req));
  }

  @HttpCode(200)
  @Post("password/forgot")
  forgotPassword(@Body() body: unknown) {
    return this.auth.forgotPassword(body);
  }

  @HttpCode(200)
  @Post("password/reset")
  resetPassword(@Body() body: unknown, @Req() req: Request) {
    return this.auth.resetPassword(body, metaOf(req));
  }

  @UseGuards(JwtGuard)
  @Get("me")
  me(@Req() req: Request & { user: { uid: string } }) {
    return this.auth.me(req.user.uid);
  }
}
