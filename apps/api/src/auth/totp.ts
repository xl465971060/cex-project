import { createHmac, randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 解码（容忍小写/空格/连字符，忽略填充） */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 4648 base32 编码（用于生成密钥） */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * RFC 6238 TOTP（SHA1 / 30s 步长 / 6 位数字，兼容 Google Authenticator）
 * 单测锚定 RFC 6238 附录 B 官方向量（secret "1234…90" @ T=59 → 287082）
 */
export function totpAt(secretBase32: string, unixSec: number, step = 30, digits = 6): string {
  const counter = Math.floor(unixSec / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** 校验动态码，允许 ±window 步时钟偏移（默认 ±30s） */
export function totpVerify(secretBase32: string, code: string, nowSec = Math.floor(Date.now() / 1000), window = 1): boolean {
  for (let i = -window; i <= window; i++) {
    const t = nowSec + i * 30;
    if (t < 0) continue; // 1970 前:计数器无意义
    if (totpAt(secretBase32, t) === code) return true;
  }
  return false;
}

/** 生成新密钥：20 字节熵 → base32（绑定 2FA 时展示为二维码内容 otpauth://…） */
export function totpGenerateSecret(): string {
  return base32Encode(randomBytes(20));
}
