#!/usr/bin/env python3
"""
Slack 自动采集器

输入同事的 Slack 姓名/用户名，自动：
  1. 搜索 Slack 用户，获取 user_id
  2. 找到与 Bot 共同的频道，拉取该用户发出的消息
  3. 输出统一格式，直接进 create-colleague 分析流程

前置：
  python3 slack_auto_collector.py --setup   # 配置 Bot Token（一次性）

用法：
  python3 slack_auto_collector.py --name "张三" --output-dir ./knowledge/zhangsan
  python3 slack_auto_collector.py --name "john" --msg-limit 500 --channel-limit 30

所需 Bot Token Scopes（OAuth & Permissions）：
  channels:history      读取 public channel 消息
  channels:read         列出 public channels
  groups:history        读取 private channel 消息
  groups:read           列出 private channels
  im:history            读取 DM 消息（可选）
  im:read               列出 DM（可选）
  mpim:history          读取群 DM 消息（可选）
  mpim:read             列出群 DM（可选）
  users:read            搜索用户列表

注意：
  - 免费版 Workspace 仅保留最近 90 天消息
  - 需要 Workspace 管理员安装 Bot App
"""

from __future__ import annotations

import json
import sys
import time
import argparse
from pathlib import Path

from collector_common import write_text_atomic
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Optional

# ─── 依赖检查 ──────────────────────────────────────────────────────────────────

try:
    from slack_sdk import WebClient
    from slack_sdk.errors import SlackApiError
except ImportError:
    print(
        "错误：请先安装 slack_sdk：pip3 install slack-sdk",
        file=sys.stderr,
    )
    sys.exit(1)

# ─── 常量 ──────────────────────────────────────────────────────────────────────

CONFIG_PATH = Path.home() / ".colleague-skill" / "slack_config.json"

# The config file to use for this run.
#
# It is a global because the collector's own functions read it from
# several places, and the server may point it at a file of its own —
# one that holds the credentials of the person who asked for the
# collection, rather than the ones of whoever set the machine up.
_CONFIG_OVERRIDE: Path | None = None

# The time zone the reader reads in. The timestamps are the
# reader's own wall clock — so a server in another country must not
# render them in its own zone.
_TIMEZONE_OVERRIDE: Optional[str] = None

# The reader's own offset from UTC, in minutes. It is passed by the
# server so that the collector can still render the messages in the
# reader's clock on a machine that has no IANA database.
_TIMEZONE_OFFSET_MINUTES: Optional[int] = None


def _reader_tz():
    """The zone the messages are shown in.

    The epoch is a moment; the wall clock it is written as belongs to
    whoever reads it. So the zone is the reader's, and the server says
    which one it is.

    The zone *name* needs the IANA database, and `zoneinfo` has no
    database of its own: on Windows there is none, and on Alpine there
    is none unless it is installed. So the zone used to be ignored in
    silence, and the messages were rendered in the *machine's* clock —
    eight hours out for a Shanghai reader on a UTC server, and often
    on the wrong day.

    So the server also passes the reader's offset in minutes, which
    needs no database at all, and that is what is used when the zone
    cannot be loaded. The reason is said out loud, because a collection
    with the wrong hours in it is worse than one that says why.
    """
    if not _TIMEZONE_OVERRIDE:
        return None
    try:
        return ZoneInfo(_TIMEZONE_OVERRIDE)
    except Exception as e:
        print(
            f"⚠️  时区数据库里没有 {_TIMEZONE_OVERRIDE}（{e}）；"
            f"改用服务器给出的偏移 {_TIMEZONE_OFFSET_MINUTES} 分钟。"
            "安装 tzdata 可以让时区本身生效。",
            file=sys.stderr,
        )
        if _TIMEZONE_OFFSET_MINUTES is None:
            return None
        return timezone(timedelta(minutes=_TIMEZONE_OFFSET_MINUTES))


def config_path() -> Path:
    return _CONFIG_OVERRIDE or CONFIG_PATH

# Slack 频道类型（采集范围）
CHANNEL_TYPES = "public_channel,private_channel,mpim,im"

# 速率限制重试配置
MAX_RETRIES = 5
RETRY_BASE_WAIT = 1.0     # 最短等待秒数
RETRY_MAX_WAIT = 60.0     # 最长等待秒数

# 一次翻页最多翻多少页。
#
# 不是 Slack 给的上限，是我们的：万一它一直说「还有」，我们不跟着它
# 转到天荒地老。飞书那边的翻页有同样的上限。
MAX_PAGES = 200

# 采集默认值
DEFAULT_MSG_LIMIT = 1000
DEFAULT_CHANNEL_LIMIT = 50  # 最多检查的频道数

SOURCE_NAME = "slack"


# ─── 统一输出协议 ─────────────────────────────────────────────────────────────
#
# 采集器对外只有两种输出：
#   * 默认（text）：保持历史的 Markdown 报告，逐字节不变；
#   * --format json：stdout 上唯一一个归一化 JSON 对象。
#
# 进度行走 stderr（而不是 stdout），这样 stdout 只承载载荷：默认模式的输出
# 不会被进度行污染，JSON 模式下的 stdout 也保证是一个可整体解析的 JSON。

PROGRESS_PREFIX = "[PROGRESS]"


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
    """把采集到的时间转成 ISO 8601；无法解析时原样返回。"""
    raw = (value or "").strip()
    if not raw:
        return ""
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(raw, fmt).isoformat()
        except ValueError:
            continue
    return raw


def to_json_messages(records: list, source: str = SOURCE_NAME) -> list:
    """把消息记录转成统一 JSON 的消息列表。

    Slack 采集只保留目标用户发出的消息，所以角色恒为 assistant。
    """
    messages: list = []
    seen = set()
    for record in records:
        content = (record.get("content") or "").strip()
        if not content:
            continue
        timestamp = to_iso_timestamp(record.get("time", ""))
        key = (timestamp, content)
        if key in seen:
            continue
        seen.add(key)
        message = {
            "role": "assistant",
            "content": content,
            "timestamp": timestamp,
            "source": source,
        }
        # Slack's own id, when there is one.
        #
        # The server uses it to tell one message from another when the
        # message has no time of its own.
        message_id = str(record.get("id", "") or "")
        if message_id:
            message["id"] = message_id
        messages.append(message)
    return messages


def build_json_payload(messages: list, source: str = SOURCE_NAME, truncated: bool = False) -> dict:
    """构造跨采集器统一的 JSON 载荷。"""
    return {
        "messages": messages,
        "meta": {"total": len(messages), "source": source, "truncated": truncated},
    }


def print_json_payload(payload: dict) -> None:
    """在 stdout 上打印唯一一个归一化 JSON 对象。"""
    print(json.dumps(payload, ensure_ascii=False), flush=True)


# ─── 错误类型 ──────────────────────────────────────────────────────────────────

class SlackCollectorError(Exception):
    """采集过程中的可预期错误，直接退出"""


class SlackScopeError(SlackCollectorError):
    """Bot Token 缺少必要的 scope 权限"""


class SlackAuthError(SlackCollectorError):
    """Token 无效或已过期"""


# ─── 配置管理 ──────────────────────────────────────────────────────────────────

def load_config() -> dict:
    path = config_path()
    if not path.exists():
        print(
            "未找到配置，请先运行：python3 slack_auto_collector.py --setup",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        # The encoding is stated: the default is the machine's, which on
        # Windows is the ANSI code page, and this file holds Chinese.
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"配置文件损坏，请重新运行 --setup：{path}", file=sys.stderr)
        sys.exit(1)


def save_config(config: dict) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # The file holds a bot token and an app secret — so it is readable
    # by its owner only. The default mode is 0644, which is every local
    # user on the machine.
    # The encoding is stated: without it a value with a Chinese character
    # in it raised UnicodeEncodeError on Windows, and the credential was
    # never written at all.
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass



def ask_secret(question: str) -> str:
    """
    问一个秘密——而且不回显。

    它原来用的是普通的 `input()`，所以那个 App Secret 一个字一个字地
    打在终端上：它留在那个终端窗口的滚屏里，也留在任何一次录屏里。
    `getpass` 不回显。

    没有人（或者没有终端）的时候，它返回空——和在别处一样。
    """
    try:
        if not sys.stdin or not sys.stdin.isatty():
            return ""
        import getpass

        return getpass.getpass(question).strip()
    except (EOFError, KeyboardInterrupt):
        return ""

def setup_config() -> None:
    print("=== Slack 自动采集配置 ===\n")
    print("步骤 1：前往 https://api.slack.com/apps 创建新 App")
    print("        选择「From scratch」→ 填写 App Name → 选择目标 Workspace\n")
    print("步骤 2：进入 OAuth & Permissions，在 Bot Token Scopes 添加：")
    print()
    print("  消息类（必需）：")
    print("    channels:history     读取 public channel 历史消息")
    print("    groups:history       读取 private channel 历史消息")
    print("    mpim:history         读取群 DM 历史消息")
    print("    im:history           读取 DM 历史消息（可选）")
    print()
    print("  频道信息（必需）：")
    print("    channels:read        列出 public channels")
    print("    groups:read          列出 private channels")
    print("    mpim:read            列出群 DM")
    print("    im:read              列出 DM（可选）")
    print()
    print("  用户信息（必需）：")
    print("    users:read           搜索用户列表")
    print()
    print("步骤 3：Install to Workspace → 复制 Bot User OAuth Token（xoxb-...）")
    print("步骤 4：将 Bot 加入目标频道（/invite @your-bot-name）\n")

    token = ask_secret("Bot User OAuth Token (xoxb-...): ")
    if not token.startswith("xoxb-"):
        print("警告：Token 格式不对，应以 xoxb- 开头", file=sys.stderr)

    # 验证 token 是否有效
    print("\n验证 Token ...", end=" ", flush=True)
    try:
        client = WebClient(token=token)
        resp = client.auth_test()
        workspace = resp.get("team", "Unknown")
        bot_name = resp.get("user", "Unknown")
        print(f"OK\n  Workspace：{workspace}，Bot：{bot_name}")
    except SlackApiError as e:
        err = e.response.get("error", str(e))
        print(f"失败\n  错误：{err}", file=sys.stderr)
        if err == "invalid_auth":
            print("  Token 无效，请重新生成", file=sys.stderr)
        sys.exit(1)

    config = {"bot_token": token}
    save_config(config)
    print(f"\n✅ 配置已保存到 {config_path()}")
    print("   请确认已将 Bot 加入目标频道，否则无法读取消息")


# ─── Slack Client 封装（带速率限制重试）─────────────────────────────────────────

class RateLimitedClient:
    """封装 slack_sdk WebClient，自动处理 429 速率限制"""

    def __init__(self, token: str) -> None:
        self._client = WebClient(token=token)
        # 有哪些接口的翻页没有走完。
        #
        # 它原来只看得出来"没有下一页"和"接口报错了"这两件事是一样的：
        # 出错的时候 `call()` 返回一个空字典，`paginate()` 就把它当成
        # 到底了。于是 600 个成员只拿到 400 个，界面上只留下一行
        # "[API 警告] users_list 返回错误：internal_error"，而用户看到
        # 的是"未找到用户：张三"——一个关于他同事的假话。
        self.truncated_methods: set[str] = set()
        # 上一次调用是不是失败了。
        self._last_call_failed = False

    def call(self, method: str, **kwargs) -> dict:
        """调用任意 Slack API，遇到 ratelimited 自动等待重试"""
        self._last_call_failed = False
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                fn = getattr(self._client, method)
                resp = fn(**kwargs)
                return resp.data
            except SlackApiError as e:
                error = e.response.get("error", "")

                # 速率限制：读取 Retry-After header 等待
                if error == "ratelimited":
                    wait = float(
                        e.response.headers.get("Retry-After", RETRY_BASE_WAIT * attempt)
                    )
                    wait = min(wait, RETRY_MAX_WAIT)
                    print(
                        f"  [速率限制] 等待 {wait:.0f}s（第 {attempt}/{MAX_RETRIES} 次重试）...",
                        file=sys.stderr,
                    )
                    time.sleep(wait)
                    continue

                # 权限错误：直接抛出，不重试
                if error == "missing_scope":
                    missing = e.response.get("needed", "unknown")
                    raise SlackScopeError(
                        f"Bot Token 缺少权限 scope：{missing}\n"
                        f"  请前往 https://api.slack.com/apps → OAuth & Permissions → Bot Token Scopes 添加"
                    ) from e

                if error in ("invalid_auth", "token_revoked", "account_inactive"):
                    raise SlackAuthError(
                        f"Token 认证失败（{error}），请重新运行 --setup 配置新 Token"
                    ) from e

                # 频道无权限（Bot 未加入）：调用方处理
                if error in ("not_in_channel", "channel_not_found"):
                    raise

                # 其他错误：打印警告，返回空数据
                print(f"  [API 警告] {method} 返回错误：{error}", file=sys.stderr)
                self._last_call_failed = True
                return {}

        # 重试耗尽
        print(f"  [错误] {method} 多次重试后仍失败，跳过", file=sys.stderr)
        self._last_call_failed = True
        return {}

    def paginate(self, method: str, result_key: str, **kwargs) -> list:
        """
        自动翻页，返回所有结果的合并列表。

        它会停下来，两种情况：
        - 翻到页数上限，或者接口把同一个游标又给了回来（那就不是在
          往前走了，是转圈）；
        - 接口在中间报错了。

        第二种原来和"到底了"长得一模一样：出错的时候 `call()` 返回一个
        空字典，翻页就停了。于是 600 个成员只拿到 400 个，而用户看到
        的是"未找到用户：张三"——一个关于他同事的假话。

        所以停下来的时候说清楚是哪一种。
        """
        items: list = []
        cursor = None
        pages = 0

        while True:
            params = dict(kwargs)
            if cursor:
                params["cursor"] = cursor

            data = self.call(method, **params)
            if not data:
                if self._last_call_failed:
                    self.truncated_methods.add(method)
                    print(
                        f"  [API 警告] {method} 在翻页途中出错，结果不完整",
                        file=sys.stderr,
                    )
                break

            items.extend(data.get(result_key, []))

            meta = data.get("response_metadata", {})
            next_cursor = meta.get("next_cursor")
            if not next_cursor:
                break

            pages += 1
            if pages >= MAX_PAGES:
                self.truncated_methods.add(method)
                print(
                    f"  [API 警告] {method} 翻到了 {MAX_PAGES} 页上限，结果不完整",
                    file=sys.stderr,
                )
                break
            # 同一个游标又来了，那就不是在往前走了。
            if next_cursor == cursor:
                self.truncated_methods.add(method)
                print(
                    f"  [API 警告] {method} 把同一个游标又给了回来，停止翻页",
                    file=sys.stderr,
                )
                break
            cursor = next_cursor

        return items


# ─── 用户搜索 ──────────────────────────────────────────────────────────────────

def find_user(name: str, client: RateLimitedClient) -> Optional[dict]:
    """
    通过姓名（real_name / display_name / name）搜索 Slack 用户。
    支持中文姓名、英文用户名、模糊匹配。
    """
    print(f"  搜索用户：{name} ...", file=sys.stderr)

    try:
        members = client.paginate("users_list", "members", limit=200)
    except SlackScopeError as e:
        print(f"  ❌ {e}", file=sys.stderr)
        sys.exit(1)

    # 名单没有走完，所以"没找到"这句话是不知道的。
    #
    # 它原来在翻页途中出错的时候就把名单当成全部了：600 个成员只拿到
    # 400 个，然后用户看到的是"未找到用户：张三"——一个关于他同事的假
    # 话，而那个同事就在这 200 个没拿到的人里面。
    if "users_list" in client.truncated_methods:
        print(
            f"  ⚠️  用户名单没有拿完，所以「{name} 不在工作区里」这句话不能确定",
            file=sys.stderr,
        )

    # 过滤掉 Bot / 已停用账号
    members = [
        m for m in members
        if not m.get("is_bot") and not m.get("deleted") and m.get("id") != "USLACKBOT"
    ]

    name_lower = name.lower()

    def score(member: dict) -> int:
        profile = member.get("profile", {})
        real_name = (profile.get("real_name") or "").lower()
        display_name = (profile.get("display_name") or "").lower()
        username = (member.get("name") or "").lower()

        if name_lower in (real_name, display_name, username):
            return 3  # 精确匹配
        if (
            name_lower in real_name
            or name_lower in display_name
            or name_lower in username
        ):
            return 2  # 包含匹配
        # 中文名字拆字匹配
        if all(ch in real_name or ch in display_name for ch in name_lower if ch.strip()):
            return 1
        return 0

    scored = [(score(m), m) for m in members]
    candidates = [(s, m) for s, m in scored if s > 0]

    if not candidates:
        print(f"  未找到用户：{name}", file=sys.stderr)
        print(
            "  提示：请确认姓名拼写，或尝试用英文用户名（如 john.doe）",
            file=sys.stderr,
        )
        return None

    candidates.sort(key=lambda x: -x[0])

    if len(candidates) == 1:
        _, user = candidates[0]
        _print_user(user)
        return user

    # 多个候选，让用户选择
    print(f"\n  找到 {len(candidates)} 个匹配，请选择：")
    for i, (_, m) in enumerate(candidates[:10]):
        profile = m.get("profile", {})
        real_name = profile.get("real_name", "")
        display_name = profile.get("display_name", "")
        username = m.get("name", "")
        title = profile.get("title", "")
        print(f"    [{i+1}] {real_name}（@{display_name or username}）  {title}")

    # The server closes the stdin, so there is nobody to ask.
    #
    # The first candidate is taken instead of dying with a traceback:
    # Chinese names make a multi-candidate match the normal case, not
    # the exception.
    try:
        choice = input("\n  选择编号（默认 1）：").strip() or "1"
    except EOFError:
        choice = "1"
    try:
        idx = int(choice) - 1
        _, user = candidates[idx]
    except (ValueError, IndexError):
        _, user = candidates[0]

    _print_user(user)
    return user


def _print_user(user: dict) -> None:
    profile = user.get("profile", {})
    real_name = profile.get("real_name", user.get("name", ""))
    display_name = profile.get("display_name", "")
    title = profile.get("title", "")
    print(
        f"  找到用户：{real_name}（@{display_name}）  {title}",
        file=sys.stderr,
    )


# ─── 频道发现 ──────────────────────────────────────────────────────────────────

def get_channels_with_user(
    user_id: str,
    channel_limit: int,
    client: RateLimitedClient,
) -> tuple[list, int]:
    """
    返回 Bot 已加入、且目标用户也在其中的所有频道——以及有多少频道没看。

    策略：先列出 Bot 的所有频道，再逐个检查成员列表。
    """
    print("  获取频道列表 ...", file=sys.stderr)

    try:
        channels = client.paginate(
            "conversations_list",
            "channels",
            types=CHANNEL_TYPES,
            exclude_archived=True,
            limit=200,
        )
    except SlackScopeError as e:
        print(f"  ❌ {e}", file=sys.stderr)
        return []

    # 只保留 Bot 是成员的频道
    bot_channels = [c for c in channels if c.get("is_member")]
    print(f"  Bot 已加入 {len(bot_channels)} 个频道，检查成员 ...", file=sys.stderr)

    # 频道太多的时候只看前面几个——每个频道都要问一次成员。
    #
    # 但只看了前面几个，答案就不是"没有共同的频道"，而是"没看完"。所以
    # 没看的那些要记下来：目标在第 51 个频道里的时候，用户看到的是"没
    # 有共同的频道"，而实际上有——他连自己在哪个频道里都找不到了。
    unchecked = 0
    if len(bot_channels) > channel_limit:
        unchecked = len(bot_channels) - channel_limit
        print(
            f"  频道数超过上限 {channel_limit}，只检查前 {channel_limit} 个"
            f"（还有 {unchecked} 个没看）",
            file=sys.stderr,
        )
        bot_channels = bot_channels[:channel_limit]

    result = []
    for ch in bot_channels:
        ch_id = ch.get("id", "")
        ch_name = ch.get("name", ch_id)

        try:
            members = client.paginate(
                "conversations_members",
                "members",
                channel=ch_id,
                limit=200,
            )
        except SlackApiError as e:
            err = e.response.get("error", "")
            if err in ("not_in_channel", "channel_not_found"):
                continue
            print(f"    跳过频道 {ch_name}（{err}）", file=sys.stderr)
            continue
        except SlackScopeError as e:
            print(f"  ❌ {e}", file=sys.stderr)
            continue

        if user_id in members:
            result.append(ch)
            print(f"    ✓ #{ch_name}", file=sys.stderr)

    # 第二个数是有多少频道没看。
    #
    # 只看了前面几个，答案就不是"没有共同的频道"，而是"没看完"——所以
    # 没看的那些要一起交上去，调用的人才知道这个答案是不是完整的。
    return result, unchecked


# ─── 消息采集 ──────────────────────────────────────────────────────────────────

def fetch_messages_from_channel(
    channel_id: str,
    channel_name: str,
    user_id: str,
    limit: int,
    client: RateLimitedClient,
) -> list:
    """
    从指定频道拉取目标用户发出的消息。
    按时间倒序翻页，直到达到 limit 或无更多数据。
    """
    messages = []
    cursor = None
    pages_fetched = 0
    MAX_PAGES = 50  # 防止无限翻页

    while len(messages) < limit and pages_fetched < MAX_PAGES:
        params: dict = {"channel": channel_id, "limit": 200}
        if cursor:
            params["cursor"] = cursor

        try:
            data = client.call("conversations_history", **params)
        except SlackApiError as e:
            err = e.response.get("error", "")
            if err == "not_in_channel":
                print(
                    f"    Bot 不在频道 #{channel_name}，跳过（请 /invite @bot）",
                    file=sys.stderr,
                )
            else:
                print(f"    拉取 #{channel_name} 失败（{err}）", file=sys.stderr)
            break

        if not data:
            break

        pages_fetched += 1
        raw_msgs = data.get("messages", [])

        for msg in raw_msgs:
            # 只要目标用户发的、非系统消息
            if msg.get("user") != user_id:
                continue
            if msg.get("subtype"):  # join/leave/bot_message 等系统类型
                continue

            text = msg.get("text", "").strip()
            if not text:
                continue

            # 过滤纯 emoji 或纯附件消息
            if _is_noise(text):
                continue

            ts_raw = msg.get("ts", "")
            time_str = _format_ts(ts_raw)

            # 包含 thread_reply_count 说明是话题发起消息，权重更高
            is_thread_starter = bool(msg.get("reply_count", 0))

            messages.append(
                {
                    "content": text,
                    "time": time_str,
                    # Slack's own id for this message.
                    #
                    # A message with no time can only be told apart by
                    # its text and by how many times that text has been
                    # seen — and the collector returns a *window*, not
                    # the whole history, so the window moves and the
                    # new message is not imported. The id is what says
                    # "this is this one".
                    "id": str(ts_raw),
                    "channel": channel_name,
                    "is_thread_starter": is_thread_starter,
                }
            )

        meta = data.get("response_metadata", {})
        cursor = meta.get("next_cursor")
        if not cursor:
            break

    return messages[:limit]


def _is_noise(text: str) -> bool:
    """判断是否是无意义消息（纯表情、@mention、URL）"""
    import re
    # 去掉 Slack 特殊格式后几乎为空
    cleaned = re.sub(r"<[^>]+>", "", text).strip()
    cleaned = re.sub(r":[a-z_]+:", "", cleaned).strip()
    # Empty — and not "short".
    #
    # It was "shorter than two characters": so a one-character message
    # was thrown away. "好", "嗯", "k" — a person wrote them, and the
    # collector is building the record of what they said.
    return len(cleaned) == 0


def _format_ts(ts: str) -> str:
    """将 Slack timestamp（Unix float string）转为可读时间

    时间按阅读者的时区渲染：时间是"那一刻"，而写下来的钟面属于读它的人。
    服务器会告诉脚本该用哪个时区。
    """
    try:
        tz = _reader_tz()
        moment = datetime.fromtimestamp(float(ts), tz) if tz else datetime.fromtimestamp(float(ts))
        return moment.strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, OSError):
        return ts


# ─── 主采集流程 ────────────────────────────────────────────────────────────────

def collect_messages(
    user: dict,
    channels: list,
    msg_limit: int,
    client: RateLimitedClient,
) -> tuple:
    """从所有频道采集目标用户消息，返回 (Markdown 报告, 消息记录)

    报告和统一 JSON 都从同一份记录生成，两种输出永远描述同一批消息。
    """
    user_id = user["id"]
    name = user.get("profile", {}).get("real_name") or user.get("name", user_id)

    if not channels:
        return (
            f"# 消息记录\n\n"
            f"未找到与 {name} 共同的频道。\n"
            f"请确认 Bot 已被添加到相关频道（/invite @bot）\n",
            [],
            False,
        )

    all_messages: list = []
    # 这次是不是只拿到了一部分。
    #
    # 上限是它自己定的，所以服务器根本看不出来：采集器在自己的上限那里
    # 停下了，而返回的载荷说"这是全部"。于是用户看到的是一次完整的采集，
    # 而这个人的人格是从历史的一小部分里蒸馏出来的。
    truncated = False
    # The limit is the limit.
    #
    # The share per channel had a floor of a hundred — so asking for a
    # thousand messages across fifty channels fetched five thousand, and
    # every one of them was paid for in API calls and rate-limit
    # retries. The server trimmed the list afterwards; the fetching was
    # already done.
    per_channel_limit = max(1, msg_limit // max(1, len(channels)))

    report_progress(0.1)

    for index, ch in enumerate(channels):
        ch_id = ch.get("id", "")
        ch_name = ch.get("name", ch_id)
        print(f"  拉取 #{ch_name} 的消息 ...", file=sys.stderr)

        msgs = fetch_messages_from_channel(
            ch_id, ch_name, user_id, per_channel_limit, client
        )
        all_messages.extend(msgs)
        # 这个频道拿满了它那份上限——后面可能还有。
        if len(msgs) >= per_channel_limit:
            truncated = True
        print(f"    获取 {len(msgs)} 条", file=sys.stderr)
        report_progress(0.1 + 0.7 * (index + 1) / len(channels))

    report_progress(0.9)

    # 按权重分类
    thread_msgs = [m for m in all_messages if m["is_thread_starter"]]
    long_msgs = [
        m for m in all_messages
        if not m["is_thread_starter"] and len(m["content"]) > 50
    ]
    short_msgs = [
        m for m in all_messages
        if not m["is_thread_starter"] and len(m["content"]) <= 50
    ]

    channel_names = ", ".join(f"#{c.get('name', c.get('id', ''))}" for c in channels)

    lines = [
        "# Slack 消息记录（自动采集）",
        f"目标：{name}",
        f"来源频道：{channel_names}",
        f"共 {len(all_messages)} 条消息",
        f"  话题发起消息：{len(thread_msgs)} 条",
        f"  长消息（>50字）：{len(long_msgs)} 条",
        f"  短消息：{len(short_msgs)} 条",
        "",
        "---",
        "",
        "## 话题发起消息（权重最高：观点/决策/技术分享）",
        "",
    ]
    for m in thread_msgs:
        lines.append(f"[{m['time']}][#{m['channel']}] {m['content']}")
        lines.append("")

    lines += [
        "---",
        "",
        "## 长消息（观点/方案/讨论类）",
        "",
    ]
    for m in long_msgs:
        lines.append(f"[{m['time']}][#{m['channel']}] {m['content']}")
        lines.append("")

    lines += ["---", "", "## 日常消息（风格参考）", ""]
    for m in short_msgs[:300]:
        lines.append(f"[{m['time']}] {m['content']}")

    return "\n".join(lines), all_messages, truncated


def collect_all(
    name: str,
    output_dir: Path,
    msg_limit: int,
    channel_limit: int,
    config: dict,
    output_format: str = "text",
) -> dict:
    """采集某同事的所有 Slack 数据，输出到 output_dir"""
    output_dir.mkdir(parents=True, exist_ok=True)
    results: dict = {}

    print(f"\n🔍 开始采集：{name}\n", file=sys.stderr)

    # 初始化 Client
    try:
        client = RateLimitedClient(config["bot_token"])
        # 快速验证 token 有效性
        auth_data = client.call("auth_test")
        if not auth_data:
            raise SlackAuthError("auth_test 无响应，请检查 Token")
        print(
            f"  Workspace：{auth_data.get('team')}，Bot：{auth_data.get('user')}",
            file=sys.stderr,
        )
    except SlackAuthError as e:
        print(f"❌ {e}", file=sys.stderr)
        sys.exit(1)

    # Step 1: 搜索用户
    user = find_user(name, client)
    if not user:
        print(f"❌ 未找到用户 {name}，请检查姓名/用户名是否正确", file=sys.stderr)
        sys.exit(1)

    user_id = user["id"]
    profile = user.get("profile", {})
    real_name = profile.get("real_name") or user.get("name", user_id)

    # Step 2: 找共同频道
    print(f"\n📡 查找与 {real_name} 共同的频道（上限 {channel_limit} 个）...", file=sys.stderr)
    channels, unchecked_channels = get_channels_with_user(user_id, channel_limit, client)
    print(f"  共同频道：{len(channels)} 个", file=sys.stderr)
    # 频道列表本身没有走完，所以"没有共同的频道"这句话是不知道的。
    if "conversations_list" in client.truncated_methods:
        print(
            "  ⚠️  频道列表没有拿完，所以「没有共同的频道」这句话不能确定",
            file=sys.stderr,
        )
    if unchecked_channels:
        # 答案不完整，所以说出来。
        #
        # 目标在没看的那几个频道里的话，用户看到的是"没有共同的频道"——
        # 一个关于他同事的假话，而他连同事在哪个频道里都找不到了。
        print(
            f"  ⚠️  还有 {unchecked_channels} 个频道没有检查，"
            f"所以这份结果可能不完整",
            file=sys.stderr,
        )

    # Step 3: 采集消息
    print(f"\n📨 采集消息记录（上限 {msg_limit} 条）...", file=sys.stderr)
    try:
        msg_content, records, truncated = collect_messages(user, channels, msg_limit, client)
        msg_path = output_dir / "messages.txt"
        write_text_atomic(msg_path, msg_content)
        results["messages"] = str(msg_path)
        print(f"  ✅ 消息记录 → {msg_path}", file=sys.stderr)
        if output_format == "json":
            print_json_payload(build_json_payload(to_json_messages(records), truncated=truncated))
    except SlackCollectorError as e:
        print(f"  ❌ {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"  ⚠️  消息采集失败：{e}", file=sys.stderr)

    # 写摘要
    summary = {
        "name": real_name,
        "slack_user_id": user_id,
        "display_name": profile.get("display_name", ""),
        "title": profile.get("title", ""),
        "channels": [
            {"id": c.get("id"), "name": c.get("name")} for c in channels
        ],
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "files": results,
        "note": "免费版 Workspace 仅保留最近 90 天消息",
        # 有多少频道没看。零就是全都看了。
        "channels_unchecked": unchecked_channels,
    }
    summary_path = output_dir / "collection_summary.json"
    # ------------------------------------------------------------------
    # The summary is a note about the run, not the run itself.
    #
    # It used to be written without an encoding -- so on the Windows ANSI
    # code page the Chinese colleague's name raised UnicodeEncodeError
    # AFTER the messages had been collected and printed. The script exited
    # non-zero, and the server threw away a perfectly good collection
    # because a note about it could not be written.
    #
    # So it is written as UTF-8, and a failure to write it does not take
    # the collection down with it.
    # ------------------------------------------------------------------
    try:
        write_text_atomic(
            summary_path,
            json.dumps(summary, ensure_ascii=False, indent=2),
        )
    except OSError as e:
        print(f"  ⚠️  摘要写入失败：{e}", file=sys.stderr)
    print(f"  ✅ 采集摘要 → {summary_path}", file=sys.stderr)

    print(f"\n✅ 采集完成，输出目录：{output_dir}", file=sys.stderr)
    return results


# ─── CLI 入口 ──────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Slack 数据自动采集器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  # 首次配置
  python3 slack_auto_collector.py --setup

  # 采集同事数据
  python3 slack_auto_collector.py --name "张三"
  python3 slack_auto_collector.py --name "john.doe" --output-dir ./knowledge/john --msg-limit 500
        """,
    )
    parser.add_argument("--setup", action="store_true", help="初始化配置（Bot Token）")
    parser.add_argument(
        "--config",
        default=None,
        help="配置文件路径（默认 ~/.colleague-skill/slack_config.json）",
    )
    parser.add_argument("--name", help="同事姓名或 Slack 用户名")
    parser.add_argument(
        "--output-dir",
        default=None,
        help="输出目录（默认 ./knowledge/{name}）",
    )
    parser.add_argument(
        "--msg-limit",
        type=int,
        default=DEFAULT_MSG_LIMIT,
        help=f"最多采集消息条数（默认 {DEFAULT_MSG_LIMIT}）",
    )
    parser.add_argument(
        "--channel-limit",
        type=int,
        default=DEFAULT_CHANNEL_LIMIT,
        help=f"最多检查频道数（默认 {DEFAULT_CHANNEL_LIMIT}）",
    )
    parser.add_argument(
        "--format",
        choices=["text", "json"],
        default="text",
        help="输出格式：text（默认，Markdown 报告）/ json（统一 JSON，供服务端解析）",
    )
    parser.add_argument(
        "--timezone",
        default=None,
        help="阅读者所在的时区（IANA 名称，如 Asia/Shanghai）",
    )
    parser.add_argument(
        "--timezone-offset",
        type=int,
        default=None,
        help="阅读者相对 UTC 的偏移分钟数（时区库缺失时的兜底）",
    )

    args = parser.parse_args()

    global _TIMEZONE_OVERRIDE, _TIMEZONE_OFFSET_MINUTES
    _TIMEZONE_OVERRIDE = args.timezone
    _TIMEZONE_OFFSET_MINUTES = args.timezone_offset

    # The server may point the collector at a file of its own — one that
    # holds the credentials of the person who asked for the collection
    # rather than the ones of whoever set the machine up.
    global _CONFIG_OVERRIDE
    if args.config:
        _CONFIG_OVERRIDE = Path(args.config).expanduser()

    if args.setup:
        setup_config()
        return

    if not args.name:
        parser.print_help()
        parser.error("请提供 --name 参数")

    config = load_config()
    output_dir = (
        Path(args.output_dir)
        if args.output_dir
        else Path(f"./knowledge/{args.name}")
    )

    try:
        collect_all(
            name=args.name,
            output_dir=output_dir,
            msg_limit=args.msg_limit,
            channel_limit=args.channel_limit,
            config=config,
            output_format=args.format,
        )
    except SlackCollectorError as e:
        print(f"\n❌ 采集失败：{e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n\n已取消", file=sys.stderr)
        sys.exit(0)


if __name__ == "__main__":
    main()
