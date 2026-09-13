#!/usr/bin/env bash
# WSL 里借用 Windows 侧代理上网（Clash / v2rayN / Shadowsocks 等）。
#
# 用法（on/off 必须用 source，否则改不了当前终端的环境变量）：
#   source scripts/proxy.sh on [host] [port]   # 开启；不传参就全自动识别
#   source scripts/proxy.sh off                # 关闭
#   bash scripts/proxy.sh test                 # 只测连通性，不改环境
#
# 自动识别原理（不写死任何端口）：
#   1) 读 Windows 系统代理设置（注册表 ProxyServer），这是最可能的候选
#   2) 用 netstat.exe 枚举 Windows 上"对局域网开放"的监听端口（0.0.0.0/[::]）
#   3) 候选端口逐个通过宿主机发真实 HTTP 请求，能返回 204 的就是活代理
# 宿主机 = 默认网关（NAT 模式，ip route 的 via 地址）；mirrored 模式则 127.0.0.1。
# 前提：代理软件允许局域网连接（Clash: Allow LAN；v2rayN: 允许来自局域网的连接）。
# 识别失败时可手动指定：source scripts/proxy.sh on <宿主机IP> <端口>

MAX_CANDIDATES=30

_win_hosts() {
  local mode gw ns
  mode=$(wslinfo --networking-mode 2>/dev/null || echo nat)
  gw=$(ip route show default 2>/dev/null | awk '{print $3; exit}')
  ns=$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf 2>/dev/null)
  if [[ "$mode" == "mirrored" ]]; then
    printf '%s\n' 127.0.0.1 "$gw" "$ns"
  else
    printf '%s\n' "$gw" "$ns" 127.0.0.1
  fi | awk 'NF && !seen[$0]++'
}

# 候选 1：Windows 系统代理设置（注册表）。格式兼容 "host:port" 和
# "http=host:port;https=host:port" 两种，只取端口，宿主机由 _win_hosts 决定。
# 注意：reg.exe 输出是 CRLF 换行，必须先去掉 \r，否则端口值带 \r 导致探测必败。
_registry_ports() {
  command -v reg.exe >/dev/null 2>&1 || return 0
  reg.exe query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings' \
    /v ProxyServer 2>/dev/null \
    | tr -d '\r' \
    | awk '/ProxyServer/{print $NF}' \
    | tr ';,' '\n\n' \
    | awk -F= '{print $NF}' \
    | awk -F: '{print $NF}'
}

# 候选 2：Windows 上绑定了 0.0.0.0 或 [::] 的 TCP 监听端口（局域网才连得上的）。
# 同样先 tr -d '\r'：否则 $4 == "LISTENING" 永远匹配不上。
_lan_listen_ports() {
  command -v netstat.exe >/dev/null 2>&1 || return 0
  netstat.exe -an 2>/dev/null \
    | tr -d '\r' \
    | awk '$1 == "TCP" && $4 == "LISTENING" && ($2 ~ /^0\.0\.0\.0:/ || $2 ~ /^\[::\]:/)' \
    | awk '{n = split($2, a, ":"); print a[n]}' \
    | sort -un
}

_candidates() {
  { _registry_ports; _lan_listen_ports; } | awk 'NF && !seen[$0]++' | head -n "$MAX_CANDIDATES"
}

# 验证：host port scheme —— 通过它拿 Google 204 就算真代理
# 注意 max-time 要给够：走代理隧道建立首条连接可能超过 2s，太紧会误杀活代理
_probe() {
  curl -x "$3://$1:$2" -s -o /dev/null --max-time 4 http://www.gstatic.com/generate_204
}

_detect() {
  local ports h p
  ports=$(_candidates)
  if [[ -z "$ports" ]]; then
    echo "  （没读到 Windows 系统代理，也没发现局域网监听端口）"
    return 1
  fi
  echo "  候选端口: $(echo "$ports" | tr '\n' ' ')"
  echo "  第 1 轮：按 HTTP 代理验证..."
  for p in $ports; do
    for h in $(_win_hosts); do
      if _probe "$h" "$p" http; then
        DETECTED_HOST="$h"; DETECTED_PORT="$p"; DETECTED_SCHEME="http"
        return 0
      fi
    done
  done
  echo "  第 2 轮：按 SOCKS5 代理验证..."
  for p in $ports; do
    for h in $(_win_hosts); do
      if _probe "$h" "$p" socks5h; then
        DETECTED_HOST="$h"; DETECTED_PORT="$p"; DETECTED_SCHEME="socks5h"
        return 0
      fi
    done
  done
  return 1
}

_do_on() {
  local h="${1:-}" p="${2:-}" s="http"
  if [[ -z "$h" || -z "$p" ]]; then
    echo "==> 自动识别 Windows 代理（注册表 + 局域网监听端口）..."
    if ! _detect; then
      echo "✗ 没识别到可用代理，请检查："
      echo "  1) Windows 上的代理软件已启动"
      echo "  2) 已允许局域网连接（Clash: Allow LAN；v2rayN: 允许来自局域网的连接）"
      echo "  3) 还不行就手动指定：source scripts/proxy.sh on <宿主机IP> <端口>"
      return 1
    fi
    h="$DETECTED_HOST"; p="$DETECTED_PORT"; s="$DETECTED_SCHEME"
  fi
  local url="$s://$h:$p"
  export http_proxy="$url" https_proxy="$url" all_proxy="$url"
  export HTTP_PROXY="$url" HTTPS_PROXY="$url" ALL_PROXY="$url"
  export no_proxy="localhost,127.0.0.1,::1" NO_PROXY="localhost,127.0.0.1,::1"
  echo "✓ 代理已开启：$url"
  echo "  （仅对当前终端生效，新开终端要重新 source；关闭：source scripts/proxy.sh off）"
}

_do_off() {
  unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY
  echo "✓ 代理已关闭（当前终端）"
}

_http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1"; }

_do_test() {
  local code
  code=$(_http_code https://www.gstatic.com/generate_204)
  echo "直连 Google 204:      HTTP $code $([[ $code == 204 ]] && echo ✓ || echo ✗)"
  code=$(_http_code https://raw.githubusercontent.com/nvm-sh/nvm/master/README.md)
  echo "直连 GitHub raw:      HTTP $code $([[ $code == 200 ]] && echo ✓ || echo ✗)"
  if [[ -n "${http_proxy:-}" ]]; then
    echo "当前终端代理: $http_proxy"
    code=$(_http_code https://raw.githubusercontent.com/nvm-sh/nvm/master/README.md)
    echo "走代理 GitHub raw:    HTTP $code $([[ $code == 200 ]] && echo ✓ || echo ✗)"
  else
    echo "当前终端未开代理（source scripts/proxy.sh on 开启）"
  fi
}

_usage() { sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  on)   _do_on "${2:-}" "${3:-}" ;;
  off)  _do_off ;;
  test) _do_test ;;
  *)    _usage ;;
esac
