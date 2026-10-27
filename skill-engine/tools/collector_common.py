"""
采集器共用的小工具。

它们是各自独立的脚本（服务器一个一个地跑它们），所以有些东西是每份
复制一遍的。这份是共用的那一小块。
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path


def configure_stdio() -> None:
    """
    把标准输出和标准错误设成 UTF-8。

    这些脚本打印的是中文——帮助文字、错误说明、采集到的话。标准流的
    编码默认跟着 locale：C locale 下它是 ASCII，于是**打印一句中文就
    抛 UnicodeEncodeError**，脚本死在它自己的输出上。

    服务器给子进程设了 PYTHONIOENCODING=utf-8，所以走服务器那条路
    没事。但运维自己在终端里跑 `--setup`、或者用一条别的命令跑它，
    就没有这个环境变量——脚本会死在"请先安装 requests"这句话上，
    而且那句话根本打不出来。

    所以脚本自己说自己的语言。

    `reconfigure` 是 Python 3.7 以后才有的，而且对已经关掉的流会
    抛异常——所以两样都兜住。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass


# 它在这里就跑一次，而不是等谁去调。
#
# 有些消息是在**导入的时候**打的——"请先安装 requests"就是：那一段在
# 模块顶层，`main()` 还没开始。所以等 `main()` 去配置就太晚了，脚本
# 会死在它自己的错误说明上，而且那句话根本打不出来。
#
# 导入这一份就等于声明"这个脚本说 UTF-8"。
configure_stdio()


def _decoding_score(text: str) -> int:
    """
    这个解码看起来有多不对。

    分数越高越像是解错了。
    """
    bad = 0
    for ch in text:
        code = ord(ch)
        if code == 0xFFFD:
            # 替换字符：这一段根本没解出来。
            bad += 8
        elif 0xE000 <= code <= 0xF8FF:
            # 私用区：GB18030 用它来放"没有分配的字节"，所以它的出现
            # 几乎总是说"这份文件不是 GB18030"。
            bad += 6
        elif code < 0x20 and ch not in "\r\n\t":
            # 控制字符：正文里不该有。
            bad += 3
        elif 0xFFF0 <= code <= 0xFFFF:
            # 各种"未定义"的区段。
            bad += 2
    return bad


def decode_text(raw: bytes, candidates: tuple[str, ...] = ("utf-8-sig", "utf-8", "gb18030", "big5")) -> str:
    """
    解一段字节——挑最像样的那一种。

    原来是挨个试：UTF-8，然后 GB18030，最后用替换字符兜底。于是
    Big5 那一路**永远轮不到**——GB18030 几乎什么字节都收，所以它从
    不报错，而一份繁体的导出就被"成功"地解成一串乱码。

    把它放到 GB18030 前面也不行：那样 GB18030 的文件会被解成 Big5，
    一样是乱码，而且一样不报错。

    所以挨个解一遍，给每一个打分（替换字符、私用区、控制字符都是
    "解错了"的迹象），挑分最低的那个。分一样的时候按候选表的顺序来
    ——所以 UTF-8 赢过 GB18030，GB18030 赢过 Big5。
    """
    best: str | None = None
    best_score: int | None = None
    for encoding in candidates:
        try:
            text = raw.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
        score = _decoding_score(text)
        if best_score is None or score < best_score:
            best = text
            best_score = score
            if score == 0:
                # 不可能更好了。
                break
    if best is not None:
        return best
    # 每一个都解不了——用替换字符兜底：一个错字比一份读不出来的文件好。
    return raw.decode("utf-8", errors="replace")


def write_text_atomic(path: Path, content: str) -> None:
    """
    写一个文件——写 whole，不是写一半。

    它原来用的是 `Path.write_text`，那是"先清空，再写进去"：所以一个
    在写到一半被杀掉的采集器，留下一个**半截**的 `messages.txt`。而服务
    端读的正是那个文件——于是这个人的人格是从一段被截断的记录里蒸馏
    出来的，界面上却什么也没有说。

    它也解决了另一个问题：那几个文件是一个一个写的，所以死在两次写之
    间，目录里就留着这一轮的新消息和上一轮的旧文档。

    所以先写到一个临时文件，再挪到位——挪动是原子的，所以读的人看到
    的要么是旧的那一份，要么是完整的那一份，不会是半截的。
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporary, path)
    except BaseException:
        # 写坏了就把临时文件收掉，别把它留在目录里。
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
