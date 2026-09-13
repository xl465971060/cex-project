/**
 * M1-T2 鉴权 L1 单测:内存 Fake 替身跑通流程图 1.1/1.2/1.3 的全部情况编号。
 * 不依赖 MySQL/Redis —— L2/L3 由 verify 脚本 + 真实依赖覆盖。
 */
import { describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import type { HttpException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { AuthService, type RequestMeta } from "../src/auth/auth.service";
import { CodeService, type CodeStore } from "../src/auth/code.service";
import type { MailService } from "../src/auth/mail.service";
import { JwtGuard } from "../src/auth/jwt.guard";
import { totpAt } from "../src/auth/totp";
import type { PrismaService } from "../src/prisma.service";

const META: RequestMeta = { ip: "1.2.3.4", userAgent: "vitest-ua", region: null };
const PW = "Abcd1234";

/** 捕获业务异常并断言形状 */
async function errOf(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await p;
  } catch (e) {
    const ex = e as HttpException;
    return { status: ex.getStatus(), code: (ex.getResponse() as { code: string }).code };
  }
  throw new Error("预期抛出业务异常,但没有");
}

/** 内存版 Prisma 替身:只实现 auth.service 用到的查询形状 */
class FakePrisma {
  users: Record<string, unknown>[] = [];
  securities: Record<string, unknown>[] = [];
  events: Record<string, unknown>[] = [];
  private seq = 0;

  user = {
    findUnique: async ({
      where,
      include
    }: {
      where: { email?: string; id?: string };
      include?: { security?: boolean };
    }) => {
      const u = this.users.find(
        (x) => (where.email && x.email === where.email) || (where.id && x.id === where.id)
      );
      if (!u) return null;
      // 真实 Prisma 会按 include 内联关联,替身同语义
      return include?.security ? { ...u, security: this.securities.find((s) => s.uid === u.id) ?? null } : u;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const u = this.users.find((x) => x.id === where.id)!;
      Object.assign(u, data);
      return u;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const u = { id: `u${++this.seq}`, status: "ACTIVE", region: null, invitedBy: null, ...data };
      this.users.push(u);
      return u;
    }
  };

  /** 访问器名与 Prisma 生成一致:模型 UserSecurity → prisma.userSecurity */
  userSecurity = {
    findUnique: async ({ where }: { where: { uid: string } }) =>
      this.securities.find((s) => s.uid === where.uid) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const s = { totpEnabled: false, tokenVersion: 0, forbiddenUntil: null, ...data };
      this.securities.push(s);
      return s;
    },
    update: async ({ where, data }: { where: { uid: string }; data: Record<string, unknown> }) => {
      const s = this.securities.find((x) => x.uid === where.uid)!;
      const inc = data.tokenVersion as { increment?: number } | undefined;
      Object.assign(s, data, inc?.increment ? { tokenVersion: (s.tokenVersion as number) + inc.increment } : {});
      return s;
    }
  };

  securityEvent = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      this.events.find((e) => {
        if (where.uid && e.uid !== where.uid) return false;
        const cond = where.type as string | { in?: string[] } | undefined;
        const types = cond && typeof cond === "object" ? cond.in : undefined;
        if (types && !types.includes(e.type as string)) return false;
        if (cond && typeof cond === "string" && e.type !== cond) return false;
        if ("ip" in where && e.ip !== where.ip) return false;
        if ("userAgent" in where && e.userAgent !== where.userAgent) return false;
        return true;
      }) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const e = { id: `e${++this.seq}`, createdAt: new Date(), ...data };
      this.events.push(e);
      return e;
    }
  };

  async $transaction(arg: unknown) {
    if (Array.isArray(arg)) {
      const out: unknown[] = [];
      for (const p of arg) out.push(await p);
      return out;
    }
    return await (arg as (tx: FakePrisma) => unknown)(this);
  }
}

/** 内存版验证码存储(等价 Redis 语义:incr 保 TTL、setNx 已存即败) */
class FakeCodeStore implements CodeStore {
  map = new Map<string, { v: string; exp: number }>();

  async get(k: string): Promise<string | null> {
    const e = this.map.get(k);
    if (!e) return null;
    if (e.exp <= Date.now()) {
      this.map.delete(k);
      return null;
    }
    return e.v;
  }
  async setEx(k: string, v: string, ttlSec: number): Promise<void> {
    this.map.set(k, { v, exp: Date.now() + ttlSec * 1000 });
  }
  async incr(k: string, ttlSec: number): Promise<number> {
    const n = Number((await this.get(k)) ?? 0) + 1;
    const prev = this.map.get(k);
    const exp = prev && prev.exp > Date.now() ? prev.exp : Date.now() + ttlSec * 1000;
    this.map.set(k, { v: String(n), exp });
    return n;
  }
  async setNxEx(k: string, ttlSec: number): Promise<boolean> {
    if (await this.get(k)) return false;
    await this.setEx(k, "1", ttlSec);
    return true;
  }
  async del(...keys: string[]): Promise<void> {
    for (const k of keys) this.map.delete(k);
  }
}

type MailRec = [string | null, string, string, Record<string, unknown>];

function build() {
  const prisma = new FakePrisma();
  const store = new FakeCodeStore();
  const codes = new CodeService(store);
  const mails: MailRec[] = [];
  const mail = { send: async (...a: MailRec[]) => void mails.push(a) } as unknown as MailService;
  const jwt = new JwtService({ secret: "test-secret", signOptions: { expiresIn: "7d" } });
  const svc = new AuthService(prisma as unknown as PrismaService, codes, mail, jwt, store);
  return { svc, prisma, store, mails, jwt };
}

/** 绕过注册流程直插一个用户 */
async function seedUser(
  prisma: FakePrisma,
  email: string,
  password: string,
  sec: Record<string, unknown> = {}
) {
  const u = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash(password, 4) }
  });
  await prisma.userSecurity.create({ data: { uid: u.id, ...sec } });
  return u;
}

/** 读出该邮箱最近一次 scene 场景验证码 */
async function lastCode(store: FakeCodeStore, scene: string, email: string): Promise<string> {
  const v = await store.get(`vc:${scene}:code:${email}`);
  expect(v).toMatch(/^\d{6}$/);
  return v!;
}

describe("1.1 注册", () => {
  it("情况4:邮箱格式非法/弱密码 → 400 VALIDATION", async () => {
    const { svc } = build();
    await expect(errOf(svc.registerInit({ email: "not-an-email", password: PW }, META))).resolves.toMatchObject({
      status: 400,
      code: "VALIDATION"
    });
    await expect(errOf(svc.registerInit({ email: "a@b.com", password: "12345678" }, META))).resolves.toMatchObject({
      code: "VALIDATION"
    });
    await expect(errOf(svc.registerInit({ email: "a@b.com", password: "abcdefgh" }, META))).resolves.toMatchObject({
      code: "VALIDATION"
    });
  });

  it("情况5:黑名单地区 → 403;黑名单未启用/地区未知放行", async () => {
    const { svc } = build();
    process.env.REGION_BLACKLIST = "CN,US";
    try {
      await expect(
        errOf(svc.registerInit({ email: "a@b.com", password: PW }, { ...META, region: "CN" }))
      ).resolves.toMatchObject({ status: 403, code: "REGION_NOT_SUPPORTED" });
      // 未上报地区 header:放行(记录空,不阻断)
      await expect(svc.registerInit({ email: "a@b.com", password: PW }, META)).resolves.toBeTruthy();
    } finally {
      delete process.env.REGION_BLACKLIST;
    }
    // 黑名单未启用:CN 也可注册
    const { svc: svc2 } = build();
    await expect(
      svc2.registerInit({ email: "c@d.com", password: PW }, { ...META, region: "CN" })
    ).resolves.toBeTruthy();
  });

  it("情况1:邮箱已注册 → 409 EMAIL_EXISTS,不发码", async () => {
    const { svc, prisma, mails } = build();
    await seedUser(prisma, "dup@b.com", PW);
    await expect(errOf(svc.registerInit({ email: "dup@b.com", password: PW }, META))).resolves.toMatchObject({
      status: 409,
      code: "EMAIL_EXISTS"
    });
    expect(mails).toHaveLength(0);
  });

  it("主流程:发码 → 邮件落 outbox → confirm 建号(哈希入库+region)+ WELCOME", async () => {
    const { svc, prisma, mails } = build();
    await svc.registerInit({ email: "new@b.com", password: PW }, { ...META, region: "HK" });
    expect(mails).toHaveLength(1);
    expect(mails[0][1]).toBe("new@b.com");
    expect(mails[0][2]).toBe("REGISTER_CODE");

    const res = await svc.registerConfirm({ email: "new@b.com", code: mails[0][3].code as string });
    expect(res.uid).toBe("u1");
    const u = await prisma.user.findUnique({ where: { email: "new@b.com" } });
    expect(await bcrypt.compare(PW, u!.passwordHash as string)).toBe(true);
    expect(u!.region).toBe("HK");
    expect(mails.at(-1)![2]).toBe("WELCOME");
  });

  it("情况6:邀请码非法不阻断(invitedBy 置空);合法则记录", async () => {
    const { svc, prisma, store } = build();
    const inviter = await seedUser(prisma, "inv@b.com", PW);

    await svc.registerInit({ email: "x@b.com", password: PW, inviteCode: "no-such-inviter" }, META);
    await svc.registerConfirm({ email: "x@b.com", code: await lastCode(store, "reg", "x@b.com") });
    expect((await prisma.user.findUnique({ where: { email: "x@b.com" } }))!.invitedBy).toBeNull();

    await svc.registerInit({ email: "y@b.com", password: PW, inviteCode: inviter.id }, META);
    await svc.registerConfirm({ email: "y@b.com", code: await lastCode(store, "reg", "y@b.com") });
    expect((await prisma.user.findUnique({ where: { email: "y@b.com" } }))!.invitedBy).toBe(inviter.id);
  });

  it("情况3:60 秒内重发 → 429 CODE_TOO_FREQUENT;模拟过期后可再发", async () => {
    const { svc, store } = build();
    await svc.registerInit({ email: "f@b.com", password: PW }, META);
    await expect(errOf(svc.registerInit({ email: "f@b.com", password: PW }, META))).resolves.toMatchObject({
      status: 429,
      code: "CODE_TOO_FREQUENT"
    });
    store.map.delete("vc:reg:lock60:f@b.com");
    await expect(svc.registerInit({ email: "f@b.com", password: PW }, META)).resolves.toBeTruthy();
  });

  it("情况3:日发送第 11 条 → 429 CODE_DAILY_LIMIT", async () => {
    const { svc, store } = build();
    await svc.registerInit({ email: "d@b.com", password: PW }, META);
    for (let i = 0; i < 9; i++) {
      store.map.delete("vc:reg:lock60:d@b.com");
      await svc.registerInit({ email: "d@b.com", password: PW }, META);
    }
    store.map.delete("vc:reg:lock60:d@b.com");
    await expect(errOf(svc.registerInit({ email: "d@b.com", password: PW }, META))).resolves.toMatchObject({
      status: 429,
      code: "CODE_DAILY_LIMIT"
    });
  });

  it("情况2:未发码/码过期 → 400 CODE_EXPIRED", async () => {
    const { svc } = build();
    await expect(errOf(svc.registerConfirm({ email: "z@b.com", code: "123456" }))).resolves.toMatchObject({
      status: 400,
      code: "CODE_EXPIRED"
    });
  });

  it("情况2:连错 5 次 → 423 CODE_LOCKED,锁定期内正确码也拒", async () => {
    const { svc, store } = build();
    await svc.registerInit({ email: "z@b.com", password: PW }, META);
    const code = await lastCode(store, "reg", "z@b.com");
    for (let i = 0; i < 4; i++) {
      await expect(errOf(svc.registerConfirm({ email: "z@b.com", code: "000000" }))).resolves.toMatchObject({
        code: "CODE_WRONG"
      });
    }
    await expect(errOf(svc.registerConfirm({ email: "z@b.com", code: "000000" }))).resolves.toMatchObject({
      status: 423,
      code: "CODE_LOCKED"
    });
    await expect(errOf(svc.registerConfirm({ email: "z@b.com", code }))).resolves.toMatchObject({
      status: 423,
      code: "CODE_LOCKED"
    });
  });

  it("confirm 时 pending 已过期 → REGISTER_SESSION_EXPIRED", async () => {
    const { svc, store } = build();
    await svc.registerInit({ email: "gone@b.com", password: PW }, META);
    store.map.delete("vc:reg:pending:gone@b.com");
    const code = await lastCode(store, "reg", "gone@b.com");
    await expect(errOf(svc.registerConfirm({ email: "gone@b.com", code }))).resolves.toMatchObject({
      code: "REGISTER_SESSION_EXPIRED"
    });
  });
});

describe("1.2 登录", () => {
  it("防撞库:密码错误与邮箱不存在返回同一错误码 401 INVALID_CREDENTIALS", async () => {
    const { svc, prisma } = build();
    await seedUser(prisma, "real@b.com", PW);
    await expect(errOf(svc.login({ email: "real@b.com", password: "Wrong999" }, META))).resolves.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS"
    });
    await expect(errOf(svc.login({ email: "ghost@b.com", password: PW }, META))).resolves.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS"
    });
  });

  it("情况2:连错 5 次锁定 30 分钟,锁定期内正确密码也拒 → 423 LOGIN_LOCKED", async () => {
    const { svc, prisma } = build();
    await seedUser(prisma, "lock@b.com", PW);
    for (let i = 0; i < 5; i++) {
      await expect(errOf(svc.login({ email: "lock@b.com", password: "Nope1234" }, META))).resolves.toMatchObject({
        code: "INVALID_CREDENTIALS"
      });
    }
    await expect(errOf(svc.login({ email: "lock@b.com", password: PW }, META))).resolves.toMatchObject({
      status: 423,
      code: "LOGIN_LOCKED"
    });
  });

  it("情况6:FROZEN 账号密码正确也拒 → 403 ACCOUNT_FROZEN", async () => {
    const { svc, prisma } = build();
    await seedUser(prisma, "frozen@b.com", PW);
    (prisma.users[0] as { status: string }).status = "FROZEN";
    await expect(errOf(svc.login({ email: "frozen@b.com", password: PW }, META))).resolves.toMatchObject({
      status: 403,
      code: "ACCOUNT_FROZEN"
    });
  });

  it("成功登录:JWT 载荷 sub/ver 正确,LOGIN 事件落库,失败计数清零可继续登录", async () => {
    const { svc, prisma, jwt } = build();
    await seedUser(prisma, "ok@b.com", PW);
    await errOf(svc.login({ email: "ok@b.com", password: "Nope1234" }, META));
    await errOf(svc.login({ email: "ok@b.com", password: "Nope1234" }, META));

    const res = await svc.login({ email: "ok@b.com", password: PW }, META);
    expect(res.user).toMatchObject({ id: "u1", email: "ok@b.com" });
    expect(jwt.decode(res.token)).toMatchObject({ sub: "u1", ver: 0 });
    // 失败不记事件;成功记 LOGIN + 首次新设备 NEW_DEVICE 共 2 条
    expect(prisma.events).toHaveLength(2);
    expect(prisma.events[0].type).toBe("LOGIN");
    expect(prisma.events[1].type).toBe("NEW_DEVICE");
    // 计数清零:再错 4 次(不足 5)仍只是普通 INVALID_CREDENTIALS
    for (let i = 0; i < 4; i++) {
      await expect(errOf(svc.login({ email: "ok@b.com", password: "Nope1234" }, META))).resolves.toMatchObject({
        code: "INVALID_CREDENTIALS"
      });
    }
  });

  it("情况3:新设备(IP+UA 首次)→ NEW_DEVICE 事件+提醒邮件;老设备不再提醒,换 IP 再触发", async () => {
    const { svc, prisma, mails } = build();
    await seedUser(prisma, "dev@b.com", PW);

    await svc.login({ email: "dev@b.com", password: PW }, META);
    expect(prisma.events.filter((e) => e.type === "NEW_DEVICE")).toHaveLength(1);
    expect(mails.filter((m) => m[2] === "NEW_DEVICE")).toHaveLength(1);

    await svc.login({ email: "dev@b.com", password: PW }, META); // 同 IP+UA
    expect(prisma.events.filter((e) => e.type === "NEW_DEVICE")).toHaveLength(1);
    expect(prisma.events.filter((e) => e.type === "LOGIN")).toHaveLength(2);

    await svc.login({ email: "dev@b.com", password: PW }, { ...META, ip: "5.6.7.8" }); // 换 IP
    expect(prisma.events.filter((e) => e.type === "NEW_DEVICE")).toHaveLength(2);
    expect(mails.filter((m) => m[2] === "NEW_DEVICE")).toHaveLength(2);
  });

  it("TOTP:未带码 → TOTP_REQUIRED;错码 → TOTP_WRONG;对码成功", async () => {
    const { svc, prisma } = build();
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    await seedUser(prisma, "totp@b.com", PW, { totpEnabled: true, totpSecretEnc: secret });

    await expect(errOf(svc.login({ email: "totp@b.com", password: PW }, META))).resolves.toMatchObject({
      status: 401,
      code: "TOTP_REQUIRED"
    });
    await expect(
      errOf(svc.login({ email: "totp@b.com", password: PW, totpCode: "000000" }, META))
    ).resolves.toMatchObject({ status: 401, code: "TOTP_WRONG" });

    const good = totpAt(secret, Math.floor(Date.now() / 1000));
    await expect(svc.login({ email: "totp@b.com", password: PW, totpCode: good }, META)).resolves.toBeTruthy();
  });

  it("TOTP 错码同样计入失败,5 次后锁定", async () => {
    const { svc, prisma } = build();
    await seedUser(prisma, "totp2@b.com", PW, {
      totpEnabled: true,
      totpSecretEnc: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    });
    for (let i = 0; i < 5; i++) {
      await errOf(svc.login({ email: "totp2@b.com", password: PW, totpCode: "000000" }, META));
    }
    await expect(
      errOf(svc.login({ email: "totp2@b.com", password: PW, totpCode: "000000" }, META))
    ).resolves.toMatchObject({ status: 423, code: "LOGIN_LOCKED" });
  });
});

describe("1.3 忘记/重置密码", () => {
  it("邮箱不存在:响应成功但不发码、不落邮件(防枚举)", async () => {
    const { svc, store, mails } = build();
    await expect(svc.forgotPassword({ email: "ghost@b.com" })).resolves.toMatchObject({
      message: expect.stringContaining("已注册")
    });
    expect(mails).toHaveLength(0);
    expect(await store.get("vc:pw:code:ghost@b.com")).toBeNull();
  });

  it("重置全链路:RESET_CODE 邮件 → 错码拒绝 → 正确重置 → tokenVersion+1/旧 token 401/24h 禁提/事件+邮件/新密码可登录", async () => {
    const { svc, prisma, store, mails, jwt } = build();
    await seedUser(prisma, "rst@b.com", PW);

    await svc.forgotPassword({ email: "rst@b.com" });
    expect(mails.filter((m) => m[2] === "RESET_CODE")).toHaveLength(1);
    const code1 = await store.get("vc:pw:code:rst@b.com");

    // 错码不通过
    await expect(
      errOf(svc.resetPassword({ email: "rst@b.com", code: "000000", newPassword: "New99999" }, META))
    ).resolves.toMatchObject({ code: "CODE_WRONG" });
    expect(code1).toMatch(/^\d{6}$/);
    expect(code1).not.toBe("000000");

    const oldToken = (await svc.login({ email: "rst@b.com", password: PW }, META)).token;
    expect(jwt.decode(oldToken)).toMatchObject({ ver: 0 });

    // 第二次发码(先解除 60s 频控锁)
    store.map.delete("vc:pw:lock60:rst@b.com");
    await svc.forgotPassword({ email: "rst@b.com" });
    const code2 = (await store.get("vc:pw:code:rst@b.com"))!;
    await svc.resetPassword({ email: "rst@b.com", code: code2, newPassword: "New99999" }, META);

    const u = await prisma.user.findUnique({ where: { email: "rst@b.com" } });
    expect(await bcrypt.compare("New99999", u!.passwordHash as string)).toBe(true);
    const sec = await prisma.userSecurity.findUnique({ where: { uid: u!.id as string } });
    expect(sec!.tokenVersion).toBe(1);
    expect((sec!.forbiddenUntil as Date).getTime()).toBeGreaterThan(Date.now() + 23.9 * 3600 * 1000);
    expect(prisma.events.at(-1)!.type).toBe("PASSWORD_CHANGED");
    expect(mails.at(-1)![2]).toBe("PASSWORD_CHANGED");

    // 旧 token(ver=0)过 guard → SESSION_EXPIRED;新 token(ver=1)通过并解析出 uid
    await expect(errOf(guardCheck(jwt, prisma, oldToken))).resolves.toMatchObject({ code: "SESSION_EXPIRED" });
    const fresh = (await svc.login({ email: "rst@b.com", password: "New99999" }, META)).token;
    expect(jwt.decode(fresh)).toMatchObject({ ver: 1 });
    await expect(guardCheck(jwt, prisma, fresh)).resolves.toBe("u1");
  });
});

/** 直接调用 JwtGuard(模拟 ExecutionContext):通过返回 uid,失败抛业务异常 */
async function guardCheck(jwt: JwtService, prisma: FakePrisma, token: string): Promise<string> {
  const req: { headers: Record<string, string>; user?: { uid: string } } = {
    headers: { authorization: `Bearer ${token}` }
  };
  const guard = new JwtGuard(jwt, prisma as unknown as PrismaService);
  const ok = await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as never);
  if (!ok) throw new Error("guard 未通过");
  return req.user!.uid;
}
