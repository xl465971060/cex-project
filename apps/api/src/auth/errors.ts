import { HttpException } from "@nestjs/common";

/** 统一业务错误：HTTP 状态码 + 业务错误码（前端按 code 分支处理） */
export function apiError(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}
