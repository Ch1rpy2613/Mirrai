#!/usr/bin/env python3
"""
邮件解析器

支持格式：
1. .eml 文件（标准邮件格式）
2. .txt 文件（纯文本邮件记录）
3. .mbox 文件（多封邮件合集）

用法：
    python email_parser.py --file emails.eml --target "zhangsan@company.com" --output output.txt
    python email_parser.py --file inbox.mbox --target "张三" --output output.txt

    # 统一 JSON 出口（服务端只解析这一种格式）
    python email_parser.py --file emails.eml --target "zhangsan@company.com" --format json
"""

import email
import email.policy
import json
import mailbox
import re
import sys
import argparse
from pathlib import Path
from email.header import decode_header
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser


# ─── 统一输出协议 ─────────────────────────────────────────────────────────────
#
# 采集器对外只有两种输出：
#   * 默认（text）：保持历史的 Markdown 报告，逐字节不变；
#   * --format json：stdout 上唯一一个归一化 JSON 对象。
#
# 进度行走 stderr（而不是 stdout），这样 stdout 只承载载荷：默认模式的输出
# 不会被进度行污染，JSON 模式下的 stdout 也保证是一个可整体解析的 JSON。

PROGRESS_PREFIX = "[PROGRESS]"

SOURCE_NAME = "email"


def report_progress(fraction: float) -> None:
    """把进度写进 stderr，格式为 `[PROGRESS] 0.42`。

    服务端 `server/collectors/runner.ts` 会把这个协议换算成 0..100 的整数。
    """
    value = float(fraction)
    if value < 0.0:
        value = 0.0
    elif value > 1.0:
        value = 1.0
    print(f"{PROGRESS_PREFIX} {value:.2f}", file=sys.stderr, flush=True)


def to_iso_timestamp(value: str) -> str:
    """把邮件头里的日期转成 ISO 8601；无法解析时原样返回。"""
    raw = (value or "").strip()
    if not raw:
        return ""
    try:
        parsed = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return raw
    if parsed is None:
        return raw
    try:
        return parsed.isoformat()
    except (TypeError, ValueError):
        return raw


def to_json_messages(emails: list[dict], source: str = SOURCE_NAME) -> list[dict]:
    """把邮件转成统一 JSON 的消息列表。

    邮件只保留目标人发出的，所以角色恒为 assistant；正文是「主题 + 正文」。
    """
    messages: list[dict] = []
    for mail in emails:
        subject = (mail.get("subject") or "").strip()
        body = (mail.get("body") or "").strip()
        if subject and body:
            content = f"{subject}\n{body}"
        else:
            content = subject or body
        if not content:
            continue
        messages.append({
            "role": "assistant",
            "content": content,
            "timestamp": to_iso_timestamp(mail.get("date", "")),
            "source": source,
        })
    return messages


def build_json_payload(messages: list[dict], source: str = SOURCE_NAME, truncated: bool = False) -> dict:
    """构造跨采集器统一的 JSON 载荷。"""
    return {
        "messages": messages,
        "meta": {"total": len(messages), "source": source, "truncated": truncated},
    }


def print_json_payload(payload: dict) -> None:
    """在 stdout 上打印唯一一个归一化 JSON 对象。"""
    print(json.dumps(payload, ensure_ascii=False), flush=True)


class HTMLTextExtractor(HTMLParser):
    """从 HTML 邮件内容中提取纯文本"""

    def __init__(self):
        super().__init__()
        self.result = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = False
        if tag in ("p", "br", "div", "tr"):
            self.result.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.result.append(data)

    def get_text(self):
        return re.sub(r"\n{3,}", "\n\n", "".join(self.result)).strip()


def decode_mime_str(s) -> str:
    """解码 MIME 编码的邮件头字段

    `s` 可以是字符串，也可以是 `email.header.Header` 对象。后者必须原样
    传进来：先 `str()` 会让 Header 用伪字符集 "unknown-8bit" 解码，把每一个
    非 ASCII 字符变成 U+FFFD，中文主题就变成了乱码。
    """
    if not s:
        return ""
    parts = decode_header(s)
    result = []
    for part, charset in parts:
        if isinstance(part, bytes):
            # "unknown-8bit" 是邮件头解析器给出的占位字符集，它并不是真实
            # 的编码。这种情况下字节几乎总是 UTF-8。
            if not charset or charset.lower() in ("unknown-8bit", "unknown-8bit-ext"):
                charset = "utf-8"
            try:
                result.append(part.decode(charset, errors="replace"))
            except Exception:
                result.append(part.decode("utf-8", errors="replace"))
        else:
            result.append(str(part))
    return "".join(result)


def _strip_signature(body: str) -> str:
    """去掉签名分隔线，但保留分隔线之后的正文。

    原来的写法是 `re.sub(r"\n_{3,}\n.*", "", body, flags=re.DOTALL)`。
    `DOTALL` 让 `.*` 一直吃到正文末尾，所以只要正文里出现一行三个以上
    的下划线（Outlook / Foxmail 的签名分隔线就是这么写的），正文的后半
    段——结论、待办、整个第二段——就被静默地删掉了，而用户什么都不知道。

    现在只去掉那一行分隔线本身，它后面的文字一律保留：宁可多留一点
    签名噪音，也不能把用户的结论删掉。
    """
    # 分隔线：单独一行，三个以上的下划线（允许尾部有空白）。
    return re.sub(r"\n[ \t]*_{3,}[ \t]*(?=\n|$)", "\n", body)


def extract_email_body(msg) -> str:
    """从邮件对象中提取正文文本"""
    body = ""

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            disposition = str(part.get("Content-Disposition", ""))

            if "attachment" in disposition:
                continue

            if content_type == "text/plain":
                payload = part.get_payload(decode=True)
                if not payload:
                    # 空的 text/plain 段落——Outlook / Apple Mail 常见。
                    # 这里不能停：正文往往在后面的 text/html 段落里。
                    continue
                charset = part.get_content_charset() or "utf-8"
                try:
                    body = payload.decode(charset, errors="replace")
                except Exception:
                    body = payload.decode("utf-8", errors="replace")
                if body.strip():
                    break
                # 解出来是空的，也继续往下找。

            elif content_type == "text/html" and not body:
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                try:
                    html = payload.decode(charset, errors="replace")
                except Exception:
                    html = payload.decode("utf-8", errors="replace")
                extractor = HTMLTextExtractor()
                extractor.feed(html)
                body = extractor.get_text()
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            try:
                body = payload.decode(charset, errors="replace")
            except Exception:
                body = payload.decode("utf-8", errors="replace")

    # 清理引用内容（Re: 时的原文引用）
    body = re.sub(r"\n>.*", "", body)
    body = re.sub(r"\n-{3,}.*?原始邮件.*?\n", "\n", body, flags=re.DOTALL)
    body = _strip_signature(body)

    return body.strip()


def is_from_target(from_field, target: str) -> bool:
    """判断邮件是否来自目标人"""
    from_str = decode_mime_str(from_field).lower()
    target_lower = target.lower()
    return target_lower in from_str


def parse_eml_file(file_path: str, target: str) -> list[dict]:
    """解析单个 .eml 文件"""
    with open(file_path, "rb") as f:
        msg = email.message_from_binary_file(f, policy=email.policy.default)

    from_field = msg.get("From", "")
    if not is_from_target(from_field, target):
        return []

    subject = decode_mime_str(msg.get("Subject", ""))
    date = str(msg.get("Date", ""))
    body = extract_email_body(msg)

    if not body:
        return []

    return [{
        "from": decode_mime_str(from_field),
        "subject": subject,
        "date": date,
        "body": body,
    }]


#: 多少字节用来猜编码。开头就够了——声明在文件的头上。
_SNIFF_BYTES = 64 * 1024


def _text_encoding(file_path: str) -> str:
    """
    The encoding of a mail export.

    UTF-8 is what the app writes, but a mail export saved by a Chinese
    Outlook or Foxmail is very often GB18030 — and reading that as
    UTF-8 raises UnicodeDecodeError, so the whole export failed and the
    user got "the collector did not finish" and no mails at all.

    So the file is tried as UTF-8 first, and then as GB18030, and the
    bytes are decoded with replacement as a last resort: a single odd
    character is better than losing every mail in the file.

    Only the head of the file is read to sniff it. The whole file used
    to be read — twice, once to sniff and once to parse — so a large
    export was in memory twice over.
    """
    try:
        with open(file_path, "rb") as f:
            raw = f.read(_SNIFF_BYTES)
    except OSError:
        return "utf-8"

    for candidate in ("utf-8", "gb18030"):
        try:
            raw.decode(candidate)
            return candidate
        except UnicodeDecodeError:
            continue
    return "utf-8"


def parse_mbox_file(file_path: str, target: str) -> list[dict]:
    """解析 .mbox 文件（多封邮件合集）"""
    results = []
    mbox = mailbox.mbox(file_path)

    for msg in mbox:
        from_field = msg.get("From", "")
        if not is_from_target(from_field, target):
            continue

        subject = decode_mime_str(msg.get("Subject", ""))
        date = str(msg.get("Date", ""))
        body = extract_email_body(msg)

        if not body:
            continue

        results.append({
            "from": decode_mime_str(from_field),
            "subject": subject,
            "date": date,
            "body": body,
        })

    return results


def parse_txt_file(file_path: str, target: str) -> list[dict]:
    """
    解析纯文本格式的邮件记录
    支持简单的分隔格式：
    From: xxx
    Subject: xxx
    Date: xxx
    ---
    正文内容
    ===
    """
    results = []

    with open(file_path, "r", encoding=_text_encoding(file_path), errors="replace") as f:
        content = f.read()

    # 尝试按分隔符切割多封邮件
    emails_raw = re.split(r"\n={3,}\n|\n-{3,}\n(?=From:)", content)

    for raw in emails_raw:
        from_match = re.search(r"^From:\s*(.+)$", raw, re.MULTILINE)
        subject_match = re.search(r"^Subject:\s*(.+)$", raw, re.MULTILINE)
        date_match = re.search(r"^Date:\s*(.+)$", raw, re.MULTILINE)

        from_field = from_match.group(1).strip() if from_match else ""
        if not is_from_target(from_field, target):
            continue

        # 提取正文（去掉头部字段后的内容）
        body = re.sub(r"^(From|To|Subject|Date|CC|BCC):.*\n?", "", raw, flags=re.MULTILINE)
        body = body.strip()

        if not body:
            continue

        results.append({
            "from": from_field,
            "subject": subject_match.group(1).strip() if subject_match else "",
            "date": date_match.group(1).strip() if date_match else "",
            "body": body,
        })

    return results


def classify_emails(emails: list[dict]) -> dict:
    """
    对邮件按内容分类：
    - 长邮件（正文 > 200 字）：技术方案、观点陈述
    - 决策类：包含明确判断的邮件
    - 日常沟通：短邮件
    """
    long_emails = []
    decision_emails = []
    daily_emails = []

    decision_keywords = [
        "同意", "不同意", "建议", "方案", "觉得", "应该", "决定", "确认",
        "approve", "reject", "lgtm", "suggest", "recommend", "think",
        "我的看法", "我认为", "我觉得", "需要", "必须", "不需要"
    ]

    for e in emails:
        body = e["body"]

        if len(body) > 200:
            long_emails.append(e)
        elif any(kw in body.lower() for kw in decision_keywords):
            decision_emails.append(e)
        else:
            daily_emails.append(e)

    return {
        "long_emails": long_emails,
        "decision_emails": decision_emails,
        "daily_emails": daily_emails,
        "total_count": len(emails),
    }


def format_output(target: str, classified: dict) -> str:
    """格式化输出，供 AI 分析使用"""
    lines = [
        f"# 邮件提取结果",
        f"目标人物：{target}",
        f"总邮件数：{classified['total_count']}",
        "",
        "---",
        "",
        "## 长邮件（技术方案/观点类，权重最高）",
        "",
    ]

    for e in classified["long_emails"]:
        lines.append(f"**主题：{e['subject']}** [{e['date']}]")
        lines.append(e["body"])
        lines.append("")
        lines.append("---")
        lines.append("")

    lines += [
        "## 决策类邮件",
        "",
    ]

    for e in classified["decision_emails"]:
        lines.append(f"**主题：{e['subject']}** [{e['date']}]")
        lines.append(e["body"])
        lines.append("")

    lines += [
        "---",
        "",
        "## 日常沟通（风格参考）",
        "",
    ]

    for e in classified["daily_emails"][:30]:
        lines.append(f"**{e['subject']}**：{e['body'][:200]}")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="解析邮件文件，提取目标人发出的邮件")
    parser.add_argument("--file", required=True, help="输入文件路径（.eml / .mbox / .txt）")
    parser.add_argument("--target", required=True, help="目标人物（邮箱地址或姓名）")
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

    suffix = file_path.suffix.lower()

    report_progress(0.1)

    if suffix == ".eml":
        emails = parse_eml_file(str(file_path), args.target)
    elif suffix == ".mbox":
        emails = parse_mbox_file(str(file_path), args.target)
    else:
        emails = parse_txt_file(str(file_path), args.target)

    if not emails:
        print(f"警告：未找到来自 '{args.target}' 的邮件", file=sys.stderr)
        print("提示：请检查目标名称/邮箱是否与文件中的 From 字段一致", file=sys.stderr)

    report_progress(0.5)

    classified = classify_emails(emails)

    report_progress(0.8)

    if args.format == "json":
        payload = build_json_payload(to_json_messages(emails))
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
        print_json_payload(payload)
        report_progress(1.0)
        return

    output = format_output(args.target, classified)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"已输出到 {args.output}，共 {len(emails)} 封邮件")
    else:
        print(output)

    report_progress(1.0)


if __name__ == "__main__":
    main()
