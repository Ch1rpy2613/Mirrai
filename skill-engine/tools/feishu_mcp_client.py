#!/usr/bin/env python3
"""
飞书 MCP 客户端封装（cso1z/Feishu-MCP 方案）

通过 Feishu MCP Server 读取文档、wiki、消息记录。
适合：公司已授权的文档、有 App token 权限的内容。

前置要求：
  1. 安装 Feishu MCP：npm install -g feishu-mcp
  2. 配置 App ID 和 App Secret（飞书开放平台创建企业自建应用）
  3. 给应用开通必要权限（见下方 REQUIRED_PERMISSIONS）

权限列表（飞书开放平台 → 权限管理 → 开通）：
  - docs:doc:readonly          读取文档
  - wiki:wiki:readonly         读取知识库
  - im:message:readonly        读取消息
  - bitable:app:readonly       读取多维表格
  - sheets:spreadsheet:readonly 读取表格

用法：
  # 配置 token（一次性）
  python3 feishu_mcp_client.py --setup

  # 读取文档
  python3 feishu_mcp_client.py --url "https://xxx.feishu.cn/wiki/xxx" --output out.txt

  # 读取消息记录
  python3 feishu_mcp_client.py --chat-id "oc_xxx" --target "张三" --output out.txt

  # 列出某空间下的所有文档
  python3 feishu_mcp_client.py --list-wiki --space-id "xxx"
"""

from __future__ import annotations

import os
import sys
import json
import argparse
import subprocess
from pathlib import Path
from typing import Optional


CONFIG_PATH = Path.home() / ".colleague-skill" / "feishu_config.json"


# ─── 配置管理 ────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if CONFIG_PATH.exists():
        # The encoding is stated: the default is the machine's, which on
        # Windows is the ANSI code page, and this file holds Chinese.
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return {}


def save_config(config: dict) -> None:
    """
    写配置——但是**合并**，不是覆盖。

    这个文件和 `feishu_auto_collector.py` 共用。它原来是用一份全新的
    字典把整个文件盖掉：所以设一次 App ID，就会把另一个采集器放在
    同一个文件里的 `user_access_token` 和 `p2p_chat_id` 一起删掉——
    而私聊采集正是靠那两个字段才开得着的。

    而且它盖掉的时候还打印"✅ 配置完成！"。
    """
    existing = load_config()
    merged = {**existing, **{k: v for k, v in config.items() if v not in ("", None)}}
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    # The file holds the app secret and the user token — so it is
    # readable by its owner only. The default mode is 0644, which is
    # every local user on the machine.
    #
    # The other three collectors chmod this same file to 0600; this one
    # did not, so running it *downgraded* the file they had protected.
    CONFIG_PATH.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        CONFIG_PATH.chmod(0o600)
    except OSError:
        pass
    print(f"配置已保存到 {CONFIG_PATH}")


def ask(question: str) -> str:
    """
    问一个问题——当真的有人在前面的时候。

    服务器跑采集器的时候没有标准输入，所以 `input()` 抛 EOFError：整个
    脚本带着一段回溯死掉，死的地方正是需要人在浏览器前面的那一刻。

    所以没有人的时候就不问，脚本带着它已有的东西往下走。
    """
    try:
        if not sys.stdin or not sys.stdin.isatty():
            return ""
        return input(question).strip()
    except (EOFError, KeyboardInterrupt):
        return ""


def setup_config() -> None:
    print("=== 飞书 MCP 配置 ===")
    print("请前往飞书开放平台（open.feishu.cn）创建企业自建应用，获取以下信息：\n")

    app_id = ask("App ID (cli_xxx): ")
    app_secret = ask("App Secret: ")

    # 没有人回答，就什么都别写。
    #
    # 没有人在前面的时候 `ask()` 返回空——于是这个脚本会把一份
    # `{"app_id": "", "app_secret": "", "mode": "app"}` 写进去，把原来
    # 的密钥、用户令牌和私聊 id 全删掉，然后打印"✅ 配置完成！"。之后
    # 自动采集拿不到 token，私聊采集也永远开不了——而界面上一个字的
    # 线索都没有。
    if not app_id and not app_secret:
        print("没有人在前面，什么都没有改。", file=sys.stderr)
        print("配置仍然是原来那一份。", file=sys.stderr)
        return

    print("\n配置方式选择：")
    print("  [1] App Token（应用权限，需要在飞书后台开通对应权限）")
    print("  [2] User Token（个人权限，能访问你本人有权限的所有内容，需要定期刷新）")
    mode = ask("选择 [1/2]，默认 1：") or "1"

    config = {
        "app_id": app_id,
        "app_secret": app_secret,
        "mode": "app" if mode == "1" else "user",
    }

    if mode == "2":
        print("\n获取 User Token：飞书开放平台 → OAuth 2.0 → 获取 user_access_token")
        user_token = ask("User Access Token (u-xxx)：")
        config["user_token"] = user_token
        print("注意：User Token 有效期约 2 小时，过期后需要重新配置")

    save_config(config)
    print("\n✅ 配置完成！")


# ─── MCP 调用封装 ─────────────────────────────────────────────────────────────

def call_mcp(tool: str, params: dict, config: dict) -> dict:
    """
    通过 npx 调用 feishu-mcp 工具。
    feishu-mcp 支持 stdio 模式，直接 JSON 通信。
    """
    env = os.environ.copy()
    env["FEISHU_APP_ID"] = config.get("app_id", "")
    env["FEISHU_APP_SECRET"] = config.get("app_secret", "")

    if config.get("mode") == "user" and config.get("user_token"):
        env["FEISHU_USER_ACCESS_TOKEN"] = config["user_token"]

    payload = json.dumps({
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": tool,
            "arguments": params,
        },
        "id": 1,
    })

    try:
        result = subprocess.run(
            ["npx", "-y", "feishu-mcp", "--stdio"],
            input=payload,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(f"MCP 调用失败：{result.stderr}")
        return parse_mcp_envelope(result.stdout)
    except FileNotFoundError:
        print("错误：未找到 npx，请先安装 Node.js", file=sys.stderr)
        print("安装 Feishu MCP：npm install -g feishu-mcp", file=sys.stderr)
        sys.exit(1)


def parse_mcp_envelope(stdout: str) -> dict:
    """
    读出 MCP stdio 的回答。

    MCP 的回答是一层信封：``{"result": {"content": [{"type": "text",
    "text": ...}], "isError": false}}``。它的内容是一块一块的文字，不是一
    个列表，也不是一段 JSON。

    它原来被当成 ``{"result": [...]}`` 读——所以文档那一条把整个信封当成
    了文档本身，而消息那一条数到 0 条。

    信封里也可能带一行日志，所以一行一行地找，找到第一个能解成 JSON 的
    就行。
    """
    lines = [line for line in stdout.splitlines() if line.strip()]
    for line in reversed(lines):
        try:
            parsed = json.loads(line)
        except (ValueError, TypeError):
            continue
        if isinstance(parsed, dict):
            return parsed
    raise RuntimeError(f"MCP 没有返回可读的 JSON：{stdout[:300]}")


def mcp_text(result: dict) -> str:
    """
    把一次 MCP 调用的结果变成文字。

    结果里的内容是一块一块的：``{"content": [{"type": "text", "text":
    ...}], "isError": false}``。有些工具把 JSON 放在文字里，所以文字本身
    也可能是 JSON——那就把它解开。
    """
    envelope = result.get("result")
    if not isinstance(envelope, dict):
        # 有些回答直接就是内容，不带信封。
        if isinstance(envelope, list):
            return _mcp_text_from_blocks(envelope)
        if isinstance(envelope, str):
            return envelope
        return ""

    if envelope.get("isError"):
        raise RuntimeError(f"MCP 返回错误：{_mcp_text_from_blocks(envelope.get('content'))}")

    text = _mcp_text_from_blocks(envelope.get("content"))
    if not text:
        return ""
    # 有些工具把 JSON 放在文字里。
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        return text
    return json.dumps(parsed, ensure_ascii=False, indent=2)


def _mcp_text_from_blocks(content) -> str:
    """把 MCP 的内容块拼成一段文字。"""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return str(content)


def mcp_json(result: dict):
    """把一次 MCP 调用的结果变成可以当数据用的东西。"""
    envelope = result.get("result")
    if isinstance(envelope, dict):
        if envelope.get("isError"):
            raise RuntimeError(f"MCP 返回错误：{_mcp_text_from_blocks(envelope.get('content'))}")
        content = envelope.get("content")
        if isinstance(content, list):
            text = _mcp_text_from_blocks(content)
            if text:
                try:
                    return json.loads(text)
                except (ValueError, TypeError):
                    return text
        return content
    if isinstance(envelope, list):
        return envelope
    return envelope


def extract_doc_token(url: str) -> tuple[str, str]:
    """从飞书 URL 中提取文档 token 和类型"""
    import re
    patterns = [
        (r"/wiki/([A-Za-z0-9]+)", "wiki"),
        (r"/docx/([A-Za-z0-9]+)", "docx"),
        (r"/docs/([A-Za-z0-9]+)", "doc"),
        (r"/sheets/([A-Za-z0-9]+)", "sheet"),
        (r"/base/([A-Za-z0-9]+)", "base"),
    ]
    for pattern, doc_type in patterns:
        m = re.search(pattern, url)
        if m:
            return m.group(1), doc_type
    raise ValueError(f"无法从 URL 解析文档 token：{url}")


# ─── 功能函数 ─────────────────────────────────────────────────────────────────

def fetch_doc_via_mcp(url: str, config: dict) -> str:
    """通过 MCP 读取飞书文档或 Wiki"""
    token, doc_type = extract_doc_token(url)

    if doc_type == "wiki":
        result = call_mcp("get_wiki_node", {"token": token}, config)
    elif doc_type in ("docx", "doc"):
        result = call_mcp("get_doc_content", {"doc_token": token}, config)
    elif doc_type == "sheet":
        result = call_mcp("get_spreadsheet_content", {"spreadsheet_token": token}, config)
    else:
        raise ValueError(f"不支持的文档类型：{doc_type}")

    if "error" in result:
        raise RuntimeError(f"MCP 返回错误：{result['error']}")

    # 提取 MCP 返回的内容
    return mcp_text(result)


#: 飞书 API 单次最多 50 条。
MCP_PAGE_SIZE = 50

#: 翻页最多翻多少页——免得翻到天荒地老。
MCP_MAX_PAGES = 200


def _mcp_message_page(result: dict) -> tuple[list, str | None]:
    """一页消息，以及下一页的游标。"""
    raw = mcp_json(result)
    messages: list = []
    cursor: str | None = None

    if isinstance(raw, list):
        messages = raw
    elif isinstance(raw, dict):
        # 有些工具把消息放在一个对象里。
        for field in ("items", "messages", "data"):
            if isinstance(raw.get(field), list):
                messages = raw[field]
                break
        else:
            messages = [raw]
        for field in ("page_token", "next_page_token", "cursor"):
            value = raw.get(field)
            if isinstance(value, str) and value:
                cursor = value
                break

    return messages, cursor


def fetch_messages_via_mcp(
    chat_id: str,
    target_name: str,
    limit: int,
    config: dict,
) -> str:
    """通过 MCP 读取群聊消息记录"""
    # 一次最多 50 条——所以要多读几页。
    #
    # 它原来只读一页，所以 --limit 500 也就是 50 条：用户要 500 条，
    # 拿到 50 条，没有任何提示说剩下的没有了。
    messages: list = []
    cursor: str | None = None
    for _page in range(MCP_MAX_PAGES):
        params: dict = {
            "chat_id": chat_id,
            "page_size": min(max(limit - len(messages), 1), MCP_PAGE_SIZE),
        }
        if cursor:
            params["page_token"] = cursor
        page, cursor = _mcp_message_page(call_mcp("get_chat_messages", params, config))
        if not page:
            break
        messages.extend(page)
        if len(messages) >= limit:
            break
        if not cursor:
            break

    messages = messages[:limit]

    # 过滤目标人物
    if target_name:
        messages = [
            m for m in messages
            if target_name in str(m.get("sender", {}).get("name", ""))
        ]

    # 分类输出
    long_msgs = [m for m in messages if len(str(m.get("content", ""))) > 50]
    short_msgs = [m for m in messages if len(str(m.get("content", ""))) <= 50]

    lines = [
        "# 飞书消息记录（MCP 方案）",
        f"群聊 ID：{chat_id}",
        f"目标人物：{target_name or '全部'}",
        f"共 {len(messages)} 条",
        "",
        "---",
        "",
        "## 长消息",
        "",
    ]
    for m in long_msgs:
        sender = m.get("sender", {}).get("name", "")
        content = m.get("content", "")
        ts = m.get("create_time", "")
        lines.append(f"[{ts}] {sender}：{content}")
        lines.append("")

    lines += ["---", "", "## 日常消息", ""]
    for m in short_msgs[:200]:
        sender = m.get("sender", {}).get("name", "")
        content = m.get("content", "")
        lines.append(f"{sender}：{content}")

    return "\n".join(lines)


def list_wiki_docs(space_id: str, config: dict) -> str:
    """列出知识库空间下的所有文档"""
    result = call_mcp("list_wiki_nodes", {"space_id": space_id}, config)
    raw = mcp_json(result)
    if isinstance(raw, str):
        return raw
    return json.dumps(raw, ensure_ascii=False, indent=2)


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="飞书 MCP 客户端")
    parser.add_argument("--setup", action="store_true", help="初始化配置（App ID / Secret）")
    parser.add_argument("--url", help="飞书文档/Wiki/表格链接")
    parser.add_argument("--chat-id", help="群聊 ID（oc_xxx 格式）")
    parser.add_argument("--target", help="目标人物姓名")
    parser.add_argument("--limit", type=int, default=500, help="最多获取消息数")
    parser.add_argument("--list-wiki", action="store_true", help="列出知识库文档")
    parser.add_argument("--space-id", help="知识库 Space ID")
    parser.add_argument("--output", default=None, help="输出文件路径")

    args = parser.parse_args()

    if args.setup:
        setup_config()
        return

    config = load_config()
    if not config:
        print("错误：尚未配置，请先运行：python3 feishu_mcp_client.py --setup", file=sys.stderr)
        sys.exit(1)

    content = ""

    if args.url:
        print(f"通过 MCP 读取：{args.url}", file=sys.stderr)
        content = fetch_doc_via_mcp(args.url, config)

    elif args.chat_id:
        print(f"通过 MCP 读取消息：{args.chat_id}", file=sys.stderr)
        content = fetch_messages_via_mcp(
            args.chat_id,
            args.target or "",
            args.limit,
            config,
        )

    elif args.list_wiki:
        if not args.space_id:
            print("错误：--list-wiki 需要 --space-id", file=sys.stderr)
            sys.exit(1)
        content = list_wiki_docs(args.space_id, config)

    else:
        parser.print_help()
        return

    if args.output:
        Path(args.output).write_text(content, encoding="utf-8")
        print(f"✅ 已保存到 {args.output}", file=sys.stderr)
    else:
        print(content)


if __name__ == "__main__":
    main()
