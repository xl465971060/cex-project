import { describe, it, expect } from "vitest";
import { isValidEvmAddress, isValidTronAddress } from "../src/index";

describe("EVM 地址校验", () => {
  it("合法 checksum 地址通过（vitalik.eth）", () => {
    expect(isValidEvmAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
  });

  it("校验和错误时拒绝", () => {
    // 同一地址把大小写改错
    expect(isValidEvmAddress("0xd8da6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(false);
  });

  it("全小写/全大写地址按规则接受", () => {
    expect(isValidEvmAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045")).toBe(true);
  });

  it("长度不对时拒绝", () => {
    expect(isValidEvmAddress("0x1234")).toBe(false);
  });
});

describe("TRON 地址校验", () => {
  it("USDT-TRC20 合约地址通过", () => {
    expect(isValidTronAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe(true);
  });

  it("篡改字符（校验和破坏）后拒绝", () => {
    expect(isValidTronAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u")).toBe(false);
  });

  it("长度不足时拒绝", () => {
    expect(isValidTronAddress("TR7NHqje")).toBe(false);
  });

  it("非 T 开头拒绝", () => {
    expect(isValidTronAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe(false);
  });
});
