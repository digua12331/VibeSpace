"""
本地 AI 调用脚本 —— 调用腾讯 Marvis 在本机起的 llama-server（Qwen3.6-35B-A3B，OpenAI 兼容接口）。

用法：
    python scripts/local_ai_chat.py "你想问的话"
    python scripts/local_ai_chat.py            # 不带参数则进入交互模式

特点：
    - 自动探测 llama-server.exe 当前监听的端口（Marvis 重启后端口会变，避免写死失效）。
    - 探测失败时回退到默认端口 52093。
    - 依赖：Python 3.8+，标准库 urllib（无需 pip 安装任何东西）。

前提：腾讯 Marvis（或其后台进程）在运行，本机才有这个本地模型服务。
"""

import json
import subprocess
import sys
import urllib.request
import urllib.error

DEFAULT_PORT = 52093
MODEL = "mLocalModel3.6.gguf"  # = Qwen3.6-35B-A3B


def detect_port() -> int:
    """从正在运行的 llama-server.exe 进程命令行里抠出 --port，找不到就用默认端口。"""
    try:
        out = subprocess.check_output(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_Process -Filter \"name='llama-server.exe'\")"
                ".CommandLine",
            ],
            text=True,
            timeout=10,
        )
    except Exception:
        return DEFAULT_PORT
    # 命令行里形如 ... --port 52093 ...
    tokens = out.replace("\n", " ").split()
    for i, tok in enumerate(tokens):
        if tok == "--port" and i + 1 < len(tokens):
            try:
                return int(tokens[i + 1])
            except ValueError:
                pass
    return DEFAULT_PORT


def chat(message: str, base_url: str) -> str:
    body = json.dumps(
        {
            "model": MODEL,
            "messages": [{"role": "user", "content": message}],
            "temperature": 0.7,
            "max_tokens": 1024,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def main() -> None:
    # Windows 控制台默认 GBK，强制 UTF-8 避免中文乱码（Python 3.7+）
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

    port = detect_port()
    base_url = f"http://127.0.0.1:{port}"
    print(f"[本地 AI] 连接 {base_url}（模型 {MODEL}）", file=sys.stderr)

    if len(sys.argv) > 1:
        question = " ".join(sys.argv[1:])
        try:
            print(chat(question, base_url))
        except urllib.error.URLError as e:
            print(f"调用失败：{e}\n（确认腾讯 Marvis 在运行、模型已加载）", file=sys.stderr)
            sys.exit(1)
        return

    # 交互模式
    print("交互模式，输入内容回车提问，Ctrl+C 退出。")
    while True:
        try:
            q = input("\n你> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not q:
            continue
        try:
            print("AI>", chat(q, base_url))
        except urllib.error.URLError as e:
            print(f"调用失败：{e}", file=sys.stderr)


if __name__ == "__main__":
    main()
