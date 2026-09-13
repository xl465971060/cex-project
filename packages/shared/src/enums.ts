/** 订单方向 */
export const OrderSide = {
  BUY: "BUY",
  SELL: "SELL"
} as const;
export type OrderSide = (typeof OrderSide)[keyof typeof OrderSide];

/** 订单类型（MVP 一期限价 + 市价按金额） */
export const OrderType = {
  LIMIT: "LIMIT",
  MARKET: "MARKET"
} as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

/** 订单状态机：ACCEPTED → PARTIAL_FILLED → FILLED / CANCELED */
export const OrderStatus = {
  ACCEPTED: "ACCEPTED",
  PARTIAL_FILLED: "PARTIAL_FILLED",
  FILLED: "FILLED",
  CANCELED: "CANCELED",
  REJECTED: "REJECTED"
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** 提现状态机：广播(BROADCASTED)之后无撤销路径 */
export const WithdrawStatus = {
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  BROADCASTING: "BROADCASTING",
  BROADCASTED: "BROADCASTED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED"
} as const;
export type WithdrawStatus = (typeof WithdrawStatus)[keyof typeof WithdrawStatus];

/** KYC 状态 */
export const KycStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED"
} as const;
export type KycStatus = (typeof KycStatus)[keyof typeof KycStatus];

/** 账户状态 */
export const AccountStatus = {
  ACTIVE: "ACTIVE",
  FROZEN: "FROZEN",
  DISABLED: "DISABLED"
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

/** MVP 首发资产精度（最小单位位数） */
export const COIN_DECIMALS: Record<string, number> = {
  USDT: 6,
  USDC: 6,
  ETH: 18,
  BTC: 8,
  SOL: 9
};

/** 服务端口约定 */
export const SERVICE_PORTS = {
  API: 4000,
  MATCHER: 4001,
  WALLET: 4002,
  WS_GATEWAY: 4003
} as const;
