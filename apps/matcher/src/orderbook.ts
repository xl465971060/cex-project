import type { OrderSide, OrderType } from "@cex/shared";

/**
 * 撮合引擎骨架（当前仅框架，业务逻辑按《docs/MVP功能程序流程图.md》3.2 后续填充）
 * 设计约束：
 * - 单线程串行调用（Node 事件循环天然无锁）
 * - 金额全部 bigint 最小单位
 * - 后续接 Kafka order/trade 事件，HTTP 仅保留健康检查
 */

export interface OrderInput {
  id: string;
  uid: string;
  side: OrderSide;
  type: OrderType;
  /** LIMIT：限价（计价币最小单位） */
  price?: bigint;
  /** LIMIT：数量（基础币最小单位） */
  amount?: bigint;
  /** MARKET：按金额（计价币最小单位，买卖统一按金额） */
  quoteAmount?: bigint;
}

export interface Fill {
  takerOrderId: string;
  makerOrderId: string;
  price: bigint;
  amount: bigint;
}

export type PlaceResult =
  | { status: "FILLED" | "PARTIAL_FILLED" | "ACCEPTED"; fills: Fill[]; remainingBase?: bigint; refundedQuote?: bigint }
  | { status: "REJECTED"; reason: string };

export class OrderBook {
  constructor(public readonly pair: string) {}

  /** TODO(M2)：价格-时间优先撮合，分支覆盖流程图 3.2 全部情况 */
  place(_order: OrderInput): PlaceResult {
    throw new Error("撮合逻辑未实现：见 docs/MVP功能程序流程图.md §3.2");
  }

  /** TODO(M2)：撤单，返回解冻剩余量 */
  cancel(_orderId: string): bigint | undefined {
    return undefined;
  }
}
