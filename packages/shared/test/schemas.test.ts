import { describe, it, expect } from "vitest";
import { orderRequestSchema, registerSchema } from "../src/index";
import { toBaseUnits, formatBaseUnits, toCoinBaseUnits } from "../src/index";

describe("orderRequestSchema", () => {
  const base = {
    clientOrderId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    pair: "BTC/USDT",
    side: "BUY"
  };

  it("限价单：价格+数量齐全时通过", () => {
    const r = orderRequestSchema.safeParse({ ...base, type: "LIMIT", price: "50000", amount: "0.01" });
    expect(r.success).toBe(true);
  });

  it("限价单缺少 price 时拒绝", () => {
    const r = orderRequestSchema.safeParse({ ...base, type: "LIMIT", amount: "0.01" });
    expect(r.success).toBe(false);
  });

  it("市价单必须按金额 quoteAmount", () => {
    const ok = orderRequestSchema.safeParse({ ...base, type: "MARKET", quoteAmount: "100" });
    const bad = orderRequestSchema.safeParse({ ...base, type: "MARKET" });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });

  it("交易对格式非法时拒绝", () => {
    const r = orderRequestSchema.safeParse({ ...base, type: "MARKET", quoteAmount: "100", pair: "btc-usdt" });
    expect(r.success).toBe(false);
  });
});

describe("registerSchema", () => {
  it("密码强度不足时拒绝", () => {
    expect(registerSchema.safeParse({ email: "a@b.com", password: "12345678" }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "a@b.com", password: "abcdefgh" }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "a@b.com", password: "abcd1234" }).success).toBe(true);
  });
});

describe("bigint 资金精度", () => {
  it("十进制字符串 ↔ 最小单位 双向转换", () => {
    expect(toBaseUnits("0.1", 6)).toBe(100000n);
    expect(toBaseUnits("50000", 6)).toBe(50000000000n);
    expect(formatBaseUnits(100000n, 6)).toBe("0.1");
    expect(formatBaseUnits(50000000000n, 6)).toBe("50000");
  });

  it("超出精度位数时拒绝", () => {
    expect(() => toBaseUnits("0.1234567", 6)).toThrow();
  });

  it("按币种精度转换（BTC 8 位 / ETH 18 位）", () => {
    expect(toCoinBaseUnits("0.00000001", "BTC")).toBe(1n);
    expect(toCoinBaseUnits("1", "ETH")).toBe(1000000000000000000n);
    expect(() => toCoinBaseUnits("1", "XXX")).toThrow();
  });
});
