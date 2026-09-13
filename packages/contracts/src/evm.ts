import { isAddress, getAddress } from "viem";

/** EVM 地址校验（含 EIP-55 校验和规则） */
export function isValidEvmAddress(address: string): boolean {
  return isAddress(address);
}

/** EVM 地址规范化为 checksum 格式（非法时抛错） */
export function normalizeEvmAddress(address: string): string {
  return getAddress(address);
}
