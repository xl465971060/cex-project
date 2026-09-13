import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma.service";
import { parseOrThrow } from "../zod.util";
import {
  forgotPasswordSchema,
  loginSchema,
  registerConfirmSchema,
  registerSchema,
  resetPasswordSchema
} from "@cex/shared";
import { apiError } from "./errors";
import { CodeService, ERR_LOCK_SEC, RedisCodeStore, type CodeStore } from "./code.service";
import { MailService } from "./mail.service";
import { totpVerify } from "./totp";

const LOGIN_LOCK_SEC = ERR_LOCK_SEC; // 1.2 情况2:连续 5 次失败锁 30 分钟
const LOGIN_MAX_FAILS = 5;
const PENDING_TTL_SEC = 600; // 注册两阶段之间的 pending 有效期,与验证码一致

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  region: string | null;
}

/** 密码哈希成本因子:开发机够用,防爆破靠登录频控+锁定 */
const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: CodeService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    /** 接口注入:实现为 RedisCodeStore,单测换内存 Fake */
    @Inject(RedisCodeStore) private readonly store: CodeStore
  ) {}

  // ───────────────────────── 注册(流程图 1.1) ─────────────────────────

  /** 阶段一:校验并发送验证码。邮件 outbox 落库,pending 数据进 Redis 等 confirm */
  async registerInit(body: unknown, meta: RequestMeta): Promise<{ message: string }> {
    const dto = parseOrThrow(registerSchema, body);

    // 情况5:地区黑名单(REGION_BLACKLIST 非空才启用;region 取 x-client-region,M3 接 geoip)
    const blacklist = (process.env.REGION_BLACKLIST ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (blacklist.length && meta.region && blacklist.includes(meta.region.toUpperCase())) {
      apiError(403, "REGION_NOT_SUPPORTED", "该地区暂不支持注册");
    }

    // 情况1:邮箱已注册
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) apiError(409, "EMAIL_EXISTS", "该邮箱已注册");

    // 情况6:邀请码不合法不阻断注册,仅丢弃(invitedBy = 邀请人 uid)
    let invitedBy: string | null = null;
    if (dto.inviteCode) {
      const inviter = await this.prisma.user.findUnique({ where: { id: dto.inviteCode } });
      invitedBy = inviter ? inviter.id : null;
    }

    const code = await this.codes.send("reg", dto.email);
    await this.mail.send(null, dto.email, "REGISTER_CODE", { code, ttlMin: 10 });
    await this.store.setEx(
      `vc:reg:pending:${dto.email}`,
      JSON.stringify({ hash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS), invitedBy, region: meta.region }),
      PENDING_TTL_SEC
    );
    return { message: "验证码已发送,请查收邮件(10 分钟内有效)" };
  }

  /** 阶段二:验证码确认 → 建号。并发兜底再次查重,唯一索引最终兜底 */
  async registerConfirm(body: unknown): Promise<{ uid: string; email: string }> {
    const dto = parseOrThrow(registerConfirmSchema, body);
    await this.codes.verify("reg", dto.email, dto.code);

    const raw = await this.store.get(`vc:reg:pending:${dto.email}`);
    if (!raw) apiError(400, "REGISTER_SESSION_EXPIRED", "注册会话已过期,请重新注册");
    const pending = JSON.parse(raw) as { hash: string; invitedBy: string | null; region: string | null };

    const dup = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (dup) apiError(409, "EMAIL_EXISTS", "该邮箱已注册");

    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email: dto.email, passwordHash: pending.hash, region: pending.region, invitedBy: pending.invitedBy }
      });
      await tx.userSecurity.create({ data: { uid: u.id } });
      return u;
    });

    await this.mail.send(user.id, dto.email, "WELCOME");
    return { uid: user.id, email: user.email };
  }

  // ───────────────────────── 登录(流程图 1.2) ─────────────────────────

  /** 1.2 情况2:失败计数,累计 5 次触发 30 分钟锁定 */
  private async bumpFail(id: string): Promise<void> {
    const n = await this.store.incr(`auth:fail:${id}`, LOGIN_LOCK_SEC);
    if (n >= LOGIN_MAX_FAILS) {
      await this.store.setNxEx(`auth:lock:${id}`, LOGIN_LOCK_SEC);
      await this.store.del(`auth:fail:${id}`);
    }
  }

  async login(body: unknown, meta: RequestMeta): Promise<{ token: string; user: { id: string; email: string } }> {
    const dto = parseOrThrow(loginSchema, body);
    const id = dto.email;

    // 情况2:锁定中直接拒绝(即使密码正确)
    if (await this.store.get(`auth:lock:${id}`)) {
      apiError(423, "LOGIN_LOCKED", "失败次数过多,账号已锁定 30 分钟");
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { security: true }
    });
    // 防撞库:无论邮箱是否存在,错误信息一致
    const credOk = !!user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!credOk) {
      await this.bumpFail(id);
      apiError(401, "INVALID_CREDENTIALS", "邮箱或密码错误");
    }

    // 情况6:冻结账号拒绝登录
    if (user.status === "FROZEN" || user.status === "DISABLED") {
      apiError(403, "ACCOUNT_FROZEN", "账号已被冻结,请联系客服");
    }

    // 2FA 分支:开启 TOTP 后必须携带动态码
    const sec = user.security!;
    if (sec.totpEnabled) {
      if (!dto.totpCode) apiError(401, "TOTP_REQUIRED", "请输入谷歌验证码");
      const secret = sec.totpSecretEnc ?? ""; // M1 明文存于 *Enc 字段,加密存储 M2-4
      if (!secret || !totpVerify(secret, dto.totpCode)) {
        await this.bumpFail(id);
        apiError(401, "TOTP_WRONG", "谷歌验证码错误");
      }
    }

    // 情况3:新设备 = (IP + UA) 在登录/新设备历史中未出现 → 事件 + 邮件提醒
    const known = await this.prisma.securityEvent.findFirst({
      where: {
        uid: user.id,
        type: { in: ["LOGIN", "NEW_DEVICE"] },
        ip: meta.ip,
        userAgent: meta.userAgent
      }
    });
    await this.prisma.securityEvent.create({
      data: { uid: user.id, type: "LOGIN", ip: meta.ip, userAgent: meta.userAgent }
    });
    if (!known) {
      await this.prisma.securityEvent.create({
        data: { uid: user.id, type: "NEW_DEVICE", ip: meta.ip, userAgent: meta.userAgent }
      });
      await this.mail.send(user.id, user.email, "NEW_DEVICE", { ip: meta.ip, userAgent: meta.userAgent });
    }

    await this.store.del(`auth:fail:${id}`);
    // JWT 载荷带 tokenVersion:改密/重置后 ver 不匹配 → 旧 token 全端失效
    const token = await this.jwt.signAsync({ sub: user.id, ver: sec.tokenVersion });
    return { token, user: { id: user.id, email: user.email } };
  }

  // ───────────────────────── 忘记密码(流程图 1.3) ─────────────────────────

  /** 防枚举:邮箱不存在也返回成功,仅不真正发码 */
  async forgotPassword(body: unknown): Promise<{ message: string }> {
    const dto = parseOrThrow(forgotPasswordSchema, body);
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (user) {
      const code = await this.codes.send("pw", dto.email);
      await this.mail.send(user.id, dto.email, "RESET_CODE", { code, ttlMin: 10 });
    }
    return { message: "如果该邮箱已注册,重置验证码已发送" };
  }

  async resetPassword(body: unknown, meta: RequestMeta): Promise<{ message: string }> {
    const dto = parseOrThrow(resetPasswordSchema, body);
    await this.codes.verify("pw", dto.email, dto.code);

    const user = await this.prisma.user.findUnique({ where: { email: dto.email }, include: { security: true } });
    if (!user) apiError(400, "RESET_FAILED", "重置失败,请重新操作");

    // 反劫持红线:重置密码 → 全端会话失效(tokenVersion+1)+ 24h 禁提 + 邮件提醒
    const forbiddenUntil = new Date(Date.now() + 24 * 3600 * 1000);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS) }
      }),
      this.prisma.userSecurity.update({
        where: { uid: user.id },
        data: { tokenVersion: { increment: 1 }, forbiddenUntil }
      }),
      this.prisma.securityEvent.create({
        data: { uid: user.id, type: "PASSWORD_CHANGED", ip: meta.ip, userAgent: meta.userAgent }
      })
    ]);
    await this.mail.send(user.id, user.email, "PASSWORD_CHANGED", { ip: meta.ip });
    return { message: "密码已重置,请使用新密码重新登录" };
  }

  // ───────────────────────── 当前用户 ─────────────────────────

  async me(uid: string) {
    const user = await this.prisma.user.findUnique({ where: { id: uid }, include: { security: true } });
    if (!user) apiError(401, "SESSION_EXPIRED", "登录已失效,请重新登录");
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      region: user.region,
      invitedBy: user.invitedBy,
      totpEnabled: user.security?.totpEnabled ?? false,
      createdAt: user.createdAt
    };
  }
}
