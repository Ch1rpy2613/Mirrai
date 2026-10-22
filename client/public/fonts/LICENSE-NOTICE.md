MiSans 字体授权说明
====================

本目录下的 `MiSans-subset.woff2` 由小米 MiSans 可变字体（MiSansVF.ttf，版本
4.009）子集化生成。

来源
----

- 官方站点：https://hyperos.mi.com/font/details/sc
- 本机源文件：/Users/ch1rpy/Desktop/MiSans/可变字体/MiSansVF.ttf
- 版权信息（字体内置 name 表）：Copyright © 2020-2025 Beijing Xiaomi Mobile
  Software Co.,Ltd. All Rights Reserved.

授权
----

按小米官方说明，MiSans 面向全社会免费商用，允许用于印刷、网页、App 开发、
短视频等全平台创作，允许嵌入到软件或设备中。

限制
----

- 不得单独售卖字体文件本身
- 不得反向工程、拆解或修改字形后重新发布

本仓库的子集化处理
------------------

`scripts/subset-misans.py` 使用 fonttools 对字体做子集化：

- 只裁剪字符集，**不修改任何字形轮廓**
- 保留 wght 可变轴（150–700 全部字重）
- 保留全部 26 个 OpenType feature（SS01–SS09、frac、sups、case、vert、tnum
  等）以及 GPOS 的 kern
- 字符集来源：界面源码中的中文字面量 + 常用标点数字符号 + 字体 feature 会
  替换进去的额外码位（分数、上下标、Latin-1 等），因此开启任一 feature 都不会
  出现缺字

如果需要完整字库，可从官方渠道获取原始字体后按同样流程重新生成子集。
