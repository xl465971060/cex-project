import { z } from "zod";

/** 密码强度规则（注册/重置共用，流程图 1.1/1.3：≥8 位且含字母数字） */
const passwordRule = z
  .string()
  .min(8, "密码至少 8 位")
  .regex(/[A-Za-z]/, "须包含字母")
  .regex(/\d/, "须包含数字");

/** 下单请求（前后端共享校验，见 apps/web 与 apps/api 使用处） */
export const orderRequestSchema = z
  .object({
    clientOrderId: z.string().uuid(),
    pair: z.string().regex(/^[A-Z0-9]+\/[A-Z0-9]+$/, "交易对格式如 BTC/USDT"),
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["LIMIT", "MARKET"]),
    /** 限价单价格（十进制字符串） */
    price: z.string().regex(/^\d+(\.\d+)?$/).optional(),
    /** 限价单数量（十进制字符串） */
    amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
    /** 市价单按金额（计价币数量，十进制字符串） */
    quoteAmount: z.string().regex(/^\d+(\.\d+)?$/).optional()
  })
  .superRefine((v, ctx) => {
    if (v.type === "LIMIT" && (!v.price || !v.amount)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "限价单必须提供 price 与 amount" });
    }
    if (v.type === "MARKET" && !v.quoteAmount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "市价单必须提供 quoteAmount（按金额下单）" });
    }
    if (v.type === "LIMIT" && v.quoteAmount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "限价单不接受 quoteAmount" });
    }
  });
export type OrderRequest = z.infer<typeof orderRequestSchema>;

/** 提现请求 */
export const withdrawRequestSchema = z.object({
  coin: z.string().min(1),
  chain: z.string().min(1),
  address: z.string().min(20).max(128),
  amount: z.string().regex(/^\d+(\.\d+)?$/)
});
export type WithdrawRequest = z.infer<typeof withdrawRequestSchema>;

/** 注册请求 */
export const registerSchema = z.object({
  email: z.string().email(),
  password: passwordRule,
  inviteCode: z.string().optional()
});
export type RegisterRequest = z.infer<typeof registerSchema>;

/** 注册阶段二：验证码确认建号（两阶段注册的后半） */
export const registerConfirmSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "验证码为 6 位数字")
});
export type RegisterConfirmRequest = z.infer<typeof registerConfirmSchema>;

/** 登录请求 */
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** 已绑定 2FA 时必填（动态码） */
  totpCode: z.string().regex(/^\d{6}$/).optional()
});
export type LoginRequest = z.infer<typeof loginSchema>;

/** 忘记密码：请求重置码 */
export const forgotPasswordSchema = z.object({ email: z.string().email() });

/** 重置密码（流程图 1.3）：验证码 + 新密码（强度同注册） */
export const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  newPassword: passwordRule
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;
