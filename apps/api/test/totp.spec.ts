import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, totpAt, totpGenerateSecret, totpVerify } from "../src/auth/totp";

/** RFC 6238 附录 B 官方测试向量(secret ASCII "12345678901234567890",SHA1) */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP(RFC 6238)", () => {
  it("官方向量:T=59 → 287082", () => {
    expect(totpAt(RFC_SECRET, 59)).toBe("287082");
  });

  it("官方向量:T=1111111109 → 081804", () => {
    expect(totpAt(RFC_SECRET, 1111111109)).toBe("081804");
  });

  it("官方向量:T=1234567890 → 005924", () => {
    expect(totpAt(RFC_SECRET, 1234567890)).toBe("005924");
  });

  it("错误码校验不通过", () => {
    expect(totpVerify(RFC_SECRET, "000000", 59)).toBe(false);
    expect(totpVerify(RFC_SECRET, "287082", 59)).toBe(true);
  });

  it("±1 窗口时钟偏移容忍(±30s)", () => {
    const code = totpAt(RFC_SECRET, 59);
    expect(totpVerify(RFC_SECRET, code, 59 + 30)).toBe(true); // 慢了一步
    expect(totpVerify(RFC_SECRET, code, 59 - 30)).toBe(true); // 快了一步
    expect(totpVerify(RFC_SECRET, code, 59 + 90)).toBe(false); // 超出窗口
  });

  it("base32 编解码往返一致", () => {
    const raw = Buffer.from("hello cex totp secret!");
    expect(base32Decode(base32Encode(raw)).toString()).toBe(raw.toString());
  });

  it("generateSecret:20 字节熵 → 32 位标准 base32 字符", () => {
    const s = totpGenerateSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
  });
});
