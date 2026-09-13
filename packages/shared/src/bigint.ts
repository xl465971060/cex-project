import { COIN_DECIMALS } from "./enums";

/**
 * 资金精度红线：全链路使用整数最小单位（bigint），
 * 仅在「人类输入 ↔ 展示」边界做十进制字符串转换，严禁 float 参与资金计算。
 */

/** "0.1" (USDT, 6 位小数) → 100000n */
export function toBaseUnits(decimalStr: string, decimals: number): bigint {
  const s = decimalStr.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`非法数字: ${decimalStr}`);
  }
  const [intPart, fracPart = ""] = s.split(".");
  if (fracPart.length > decimals) {
    throw new Error(`精度超出 ${decimals} 位: ${decimalStr}`);
  }
  const padded = fracPart.padEnd(decimals, "0");
  return BigInt(`${intPart}${padded}`);
}

/** 100000n (USDT, 6 位小数) → "0.1" */
export function formatBaseUnits(value: bigint, decimals: number): string {
  if (value < 0n) {
    throw new Error("不允许负数");
  }
  const base = 10n ** BigInt(decimals);
  const intPart = value / base;
  const fracPart = value % base;
  if (fracPart === 0n) return intPart.toString();
  const fracStr = fracPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${intPart}.${fracStr}`;
}

/** 按币种转换（查精度表） */
export function toCoinBaseUnits(decimalStr: string, coin: string): bigint {
  const decimals = COIN_DECIMALS[coin];
  if (decimals === undefined) throw new Error(`未配置精度: ${coin}`);
  return toBaseUnits(decimalStr, decimals);
}

export function formatCoinBaseUnits(value: bigint, coin: string): string {
  const decimals = COIN_DECIMALS[coin];
  if (decimals === undefined) throw new Error(`未配置精度: ${coin}`);
  return formatBaseUnits(value, decimals);
}
