import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

export type MailType =
  | "REGISTER_CODE" // 1.1 发送验证码邮件
  | "RESET_CODE" // 1.3 发送重置验证码
  | "WELCOME" // 1.1 欢迎邮件
  | "NEW_DEVICE" // 1.2 情况3 新设备登录提醒
  | "PASSWORD_CHANGED"; // 1.3/1.6 密码变更提醒

/**
 * 邮件服务 —— M1 决策（开发线路图总览 §3.2）：只写 outbox（MailLog 表）可查不发，
 * M2-5 接真实 SMTP 后本接口不变，实现从「落库」变「落库+投递」。
 */
@Injectable()
export class MailService {
  constructor(private readonly prisma: PrismaService) {}

  async send(uid: string | null, to: string, type: MailType, payload: Record<string, unknown> = {}): Promise<void> {
    await this.prisma.mailLog.create({
      data: { uid, to, type, payload: JSON.stringify(payload) }
    });
  }
}
