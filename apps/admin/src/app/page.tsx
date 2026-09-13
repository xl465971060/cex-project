/**
 * 骨架首页：仅用于验证 Next.js 管理后台环境就绪。
 * TODO(M3)：登录 / 提现审核（双人复核）/ 用户管理 / 对账报表 六页面
 * 依据：《docs/交易所MVP-做与不做及最小流程.md》Admin 页面清单
 */
export default function AdminHomePage() {
  return (
    <main style={{ maxWidth: 720, margin: "80px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>CEX Admin - 管理后台骨架</h1>
      <p>Next.js 环境验证页。业务页面按 MVP 路线图在 M3 阶段填充。</p>
      <ul>
        <li>规划页面：登录、提现审核（双人复核）、用户管理、对账报表</li>
        <li>API 网关：<a href="http://localhost:4000/health">http://localhost:4000/health</a></li>
      </ul>
    </main>
  );
}
