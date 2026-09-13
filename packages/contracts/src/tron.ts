import { sha256 } from "@noble/hashes/sha256";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 解码（带前导零处理） */
function base58Decode(input: string): Uint8Array | null {
  let num = 0n;
  for (const ch of input) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num = num / 256n;
  }
  for (const ch of input) {
    if (ch === "1") bytes.unshift(0);
    else break;
  }
  return new Uint8Array(bytes);
}

/**
 * TRON 地址校验：Base58Check
 * 结构 = 0x41 版本字节 + 20 字节载荷 + 4 字节校验（双 SHA256 前 4 字节）
 */
export function isValidTronAddress(address: string): boolean {
  if (!address.startsWith("T") || address.length !== 34) return false;
  const raw = base58Decode(address);
  if (!raw || raw.length !== 25) return false;
  const payload = raw.subarray(0, 21);
  const checksum = raw.subarray(21);
  const hash = sha256(sha256(payload));
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== hash[i]) return false;
  }
  return true;
}

/** TRON 地址 → 十六进制（41 开头，用于与链上数据比对） */
export function tronAddressToHex(address: string): string {
  if (!isValidTronAddress(address)) throw new Error(`非法 TRON 地址: ${address}`);
  const raw = base58Decode(address)!;
  return Buffer.from(raw.subarray(0, 21)).toString("hex").toUpperCase();
}
