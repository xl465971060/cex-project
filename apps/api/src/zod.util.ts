import type { ZodType } from "zod";
import { apiError } from "./auth/errors";

/** zod 校验失败 → 400 VALIDATION（取第一条 issue 的中文提示） */
export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    apiError(400, "VALIDATION", result.error.issues[0]?.message ?? "参数错误");
  }
  return result.data;
}
