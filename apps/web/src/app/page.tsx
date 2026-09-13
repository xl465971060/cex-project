/**
 * 骨架首页：仅用于验证 Next.js 环境就绪。
 * TODO(M3)：行情页 / 现货交易页 / 资产页（充值、提现）/ 订单页 / 个人中心
 * 依据：《docs/交易所MVP-做与不做及最小流程.md》Admin 与用户端页面清单
 */
export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: "80px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>CEX 交易所 - 用户端骨架</h1>
      <p>Next.js 环境验证页。业务页面按 MVP 路线图在 M3 阶段填充。</p>
      <ul>
        <li>规划页面：行情、现货交易、资产（充值/提现）、订单、个人中心</li>
        <li>API 网关：<a href="http://localhost:4000/health">http://localhost:4000/health</a></li>
      </ul>
    </main>
  );
}
