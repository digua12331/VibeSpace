"""
本地 AI 打杂脚本 —— 调用本机自管的 Ollama / LM Studio（OpenAI 兼容接口）。

给 Claude / 终端快速喊本地小模型干 *简单* 杂活用（写提交说明、总结、起名、翻译、
简单分类）。复杂活别用它——小模型会一本正经地胡说。

用法:
    python scripts/local_ai_ask.py "用一句话介绍杭州"
    echo "把这段话总结成一句" | python scripts/local_ai_ask.py
    python scripts/local_ai_ask.py --provider lmstudio --model qwen2.5 "你好"

约定（与后端 local-ai-service.ts 保持一致）:
    - provider 固定枚举 ollama / lmstudio；地址可用环境变量覆盖：
        VIBESPACE_OLLAMA_URL    默认 http://127.0.0.1:11434
        VIBESPACE_LMSTUDIO_URL  默认 http://127.0.0.1:1234
    - 不传 --provider 时自动挑第一个能连上的后端 + 它的第一个模型。
    - 仅依赖 Python 标准库，无需 pip。
    - Windows 下强制 UTF-8 读写，中文不乱码。

前提: 本机已开着 Ollama 或 LM Studio，并加载了至少一个模型。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

PROVIDERS = {
    "ollama": ("VIBESPACE_OLLAMA_URL", "http://127.0.0.1:11434"),
    "lmstudio": ("VIBESPACE_LMSTUDIO_URL", "http://127.0.0.1:1234"),
}


def base_url(provider: str) -> str:
    env, default = PROVIDERS[provider]
    return (os.environ.get(env) or default).rstrip("/")


def http_json(url: str, data=None, timeout: int = 60):
    headers = {"Content-Type": "application/json"}
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(
        url, data=body, headers=headers, method="POST" if data is not None else "GET"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def list_models(provider: str):
    """返回模型 id 列表；连不上返回 None。"""
    try:
        data = http_json(f"{base_url(provider)}/v1/models", timeout=3)
        return [
            m["id"]
            for m in data.get("data", [])
            if isinstance(m, dict) and isinstance(m.get("id"), str)
        ]
    except Exception:
        return None


def auto_pick():
    for p in PROVIDERS:
        models = list_models(p)
        if models:
            return p, models[0]
    return None, None


def chat(provider: str, model: str, prompt: str) -> str:
    data = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "stream": False,
    }
    out = http_json(f"{base_url(provider)}/v1/chat/completions", data=data, timeout=120)
    return out["choices"][0]["message"]["content"]


def main() -> None:
    # Windows 控制台默认 GBK，强制 UTF-8 避免中文乱码。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

    ap = argparse.ArgumentParser(description="调用本机 Ollama / LM Studio 干简单杂活")
    ap.add_argument("prompt", nargs="*", help="问题/指令；省略则从 stdin 读")
    ap.add_argument(
        "--provider", choices=list(PROVIDERS), help="不传则自动挑第一个可达后端"
    )
    ap.add_argument("--model", help="不传则用该后端第一个模型")
    args = ap.parse_args()

    prompt = " ".join(args.prompt).strip() if args.prompt else sys.stdin.read().strip()
    if not prompt:
        print('没有输入。用法: python scripts/local_ai_ask.py "你的问题"', file=sys.stderr)
        sys.exit(2)

    provider, model = args.provider, args.model
    if not provider:
        provider, model = auto_pick()
        if not provider:
            print(
                "未检测到本地 AI。请先启动 Ollama 或 LM Studio 并加载模型。",
                file=sys.stderr,
            )
            sys.exit(1)
    elif not model:
        models = list_models(provider) or []
        if not models:
            print(f"{provider} 未连上或没有加载模型。", file=sys.stderr)
            sys.exit(1)
        model = models[0]

    print(f"[本地 AI] {provider} / {model}", file=sys.stderr)
    try:
        print(chat(provider, model, prompt))
    except urllib.error.URLError as e:
        print(f"调用失败: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
