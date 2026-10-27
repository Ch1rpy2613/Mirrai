#!/usr/bin/env python3
"""
飞书消息导出 JSON 解析器

支持的导出格式：
1. 飞书官方导出（群聊记录）：通常为 JSON 数组，每条消息包含 sender、content、timestamp
2. 手动整理的 TXT 格式（每行：时间 发送人：内容）

用法：
    python feishu_parser.py --file messages.json --target "张三" --output output.txt
    python feishu_parser.py --file messages.txt --target "张三" --output output.txt
"""

import json
import re
import sys
import argparse
from pathlib import Path
from datetime import datetime


def parse_feishu_json(file_path: str, target_name: str) -> list[dict]:
    """解析飞书官方导出的 JSON 格式消息"""
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    messages = []

    # 兼容多种 JSON 结构
    if isinstance(data, list):
        raw_messages = data
    elif isinstance(data, dict):
        # 可能在 data.messages 或 data.records 等字段下
        raw_messages = (
            data.get("messages")
            or data.get("records")
            or data.get("data")
            or []
        )
    else:
        return []

    for msg in raw_messages:
        sender = (
            msg.get("sender_name")
            or msg.get("sender")
            or msg.get("from")
            or msg.get("user_name")
            or ""
        )
        content = (
            msg.get("content")
            or msg.get("text")
            or msg.get("message")
            or msg.get("body")
            or ""
        )
        timestamp = (
            msg.get("timestamp")
            or msg.get("create_time")
            or msg.get("time")
            or ""
        )

        # content 可能是嵌套结构
        if isinstance(content, dict):
            content = content.get("text") or content.get("content") or str(content)
        if isinstance(content, list):
            content = " ".join(
                c.get("text", "") if isinstance(c, dict) else str(c)
                for c in content
            )

        # 过滤：只保留目标人发送的消息
        if target_name and target_name not in str(sender):
            continue

        # 过滤：跳过系统消息、表情包、撤回消息
        if not content or content.strip() in ["[图片]", "[文件]", "[撤回了一条消息]", "[语音]"]:
            continue

        messages.append({
            "sender": str(sender),
            "content": str(content).strip(),
            "timestamp": str(timestamp),
        })

    return messages


def parse_feishu_txt(file_path: str, target_name: str) -> list[dict]:
    """解析手动整理的 TXT 格式消息（格式：时间 发送人：内容）"""
    messages = []

    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # 匹配格式：2024-01-01 10:00 张三：消息内容
    pattern = re.compile(
        r"^(?P<time>\d{4}[-/]\d{1,2}[-/]\d{1,2}[\s\d:]*)\s+(?P<sender>.+?)[:：]\s*(?P<content>.+)$"
    )

    # 这个文件里有没有带时间戳的行。
    #
    # 有的话，后面不匹配的行就是**续行**——一段话被换行截断了，
    # 这是导出的聊天记录里最常见的写法。
    # 没有的话，整个文件就是没有时间戳的纯文本，每一行都是一条消息。
    has_timestamps = any(pattern.match(line.strip()) for line in lines if line.strip())

    # 上一条匹配的行是不是目标本人的。
    #
    # 续行要接在**它自己的**那条消息后面：如果上一行是别人说的，
    # 这一行就是别人说的话，不是目标本人的续行。
    last_was_target = False

    for line in lines:
        line = line.strip()
        if not line:
            continue

        m = pattern.match(line)
        if m:
            sender = m.group("sender").strip()
            content = m.group("content").strip()
            timestamp = m.group("time").strip()

            if target_name and target_name not in sender:
                last_was_target = False
                continue
            if not content:
                continue

            messages.append({
                "sender": sender,
                "content": content,
                "timestamp": timestamp,
            })
            last_was_target = True
        else:
            # 没有匹配格式的行。
            if has_timestamps and messages and last_was_target:
                # 续行：接在上一条消息后面。
                #
                # 它原来是自己的一条消息——而且因为它没有目标人的名字，
                # 原来连这条都不是，直接被丢掉了。
                messages[-1]["content"] = (messages[-1]["content"] + "\n" + line).strip()
                continue
            # 没有匹配格式，检查是否包含目标人名
            if target_name and target_name in line:
                messages.append({
                    "sender": target_name,
                    "content": line,
                    "timestamp": "",
                })
                last_was_target = True

    return messages


def extract_key_content(messages: list[dict]) -> dict:
    """
    对消息进行分类提取，区分：
    - 长消息（>50字）：可能包含观点、方案、技术判断
    - 决策类回复：包含"同意""不行""觉得""建议"等关键词
    - 日常沟通：其他消息
    """
    long_messages = []
    decision_messages = []
    daily_messages = []

    decision_keywords = [
        "同意", "不行", "觉得", "建议", "应该", "不应该", "可以", "不可以",
        "方案", "思路", "考虑", "决定", "确认", "拒绝", "推进", "暂缓",
        "没问题", "有问题", "风险", "评估", "判断"
    ]

    for msg in messages:
        content = msg["content"]

        if len(content) > 50:
            long_messages.append(msg)
        elif any(kw in content for kw in decision_keywords):
            decision_messages.append(msg)
        else:
            daily_messages.append(msg)

    return {
        "long_messages": long_messages,
        "decision_messages": decision_messages,
        "daily_messages": daily_messages,
        "total_count": len(messages),
    }


def format_output(target_name: str, extracted: dict) -> str:
    """格式化输出，供 AI 分析使用"""
    lines = [
        f"# 飞书消息提取结果",
        f"目标人物：{target_name}",
        f"总消息数：{extracted['total_count']}",
        "",
        "---",
        "",
        "## 长消息（观点/方案类，权重最高）",
        "",
    ]

    for msg in extracted["long_messages"]:
        ts = f"[{msg['timestamp']}] " if msg["timestamp"] else ""
        lines.append(f"{ts}{msg['content']}")
        lines.append("")

    lines += [
        "---",
        "",
        "## 决策类回复",
        "",
    ]

    for msg in extracted["decision_messages"]:
        ts = f"[{msg['timestamp']}] " if msg["timestamp"] else ""
        lines.append(f"{ts}{msg['content']}")
        lines.append("")

    lines += [
        "---",
        "",
        "## 日常沟通（风格参考）",
        "",
    ]

    # 日常消息只取前 100 条，避免太长
    for msg in extracted["daily_messages"][:100]:
        ts = f"[{msg['timestamp']}] " if msg["timestamp"] else ""
        lines.append(f"{ts}{msg['content']}")

    return "\n".join(lines)


def to_normalised_json(messages: list[dict], source: str = "wechat_export") -> str:
    """统一 JSON 输出，供服务端解析。

    之前这个脚本只有 Markdown 报告一种输出，而报告里只写前 100 条
    日常消息——所以一份五千条短消息的导出，服务端只拿到一百条，
    而且没有任何地方说剩下的没了。

    统一 JSON 把全部消息交出去，由服务端按上限截断，并且能说清楚
    到底有多少条、是不是被截断了。
    """
    payload = {
        "messages": [
            {
                "role": "assistant",
                "content": msg.get("content", ""),
                "timestamp": msg.get("timestamp") or None,
                "source": source,
            }
            for msg in messages
            if (msg.get("content") or "").strip()
        ],
        "meta": {"source": source, "total": len(messages)},
    }
    return json.dumps(payload, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser(description="解析飞书消息导出文件")
    parser.add_argument("--file", required=True, help="输入文件路径（.json 或 .txt）")
    parser.add_argument("--target", required=True, help="目标人物姓名（只提取此人发出的消息）")
    parser.add_argument("--output", default=None, help="输出文件路径（默认打印到 stdout）")
    parser.add_argument(
        "--format",
        choices=["text", "json"],
        default="text",
        help="输出格式：text（默认，Markdown 报告）/ json（统一 JSON，供服务端解析）",
    )

    args = parser.parse_args()

    file_path = Path(args.file)
    if not file_path.exists():
        print(f"错误：文件不存在 {file_path}", file=sys.stderr)
        sys.exit(1)

    # 根据文件类型选择解析器
    if file_path.suffix.lower() == ".json":
        messages = parse_feishu_json(str(file_path), args.target)
    else:
        messages = parse_feishu_txt(str(file_path), args.target)

    if not messages:
        print(f"警告：未找到 '{args.target}' 发出的消息", file=sys.stderr)
        print("提示：请检查目标姓名是否与文件中的发送人名称一致", file=sys.stderr)

    if args.format == "json":
        output = to_normalised_json(messages)
    else:
        extracted = extract_key_content(messages)
        output = format_output(args.target, extracted)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"已输出到 {args.output}，共 {len(messages)} 条消息")
    else:
        print(output)


if __name__ == "__main__":
    main()
