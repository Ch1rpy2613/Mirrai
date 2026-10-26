# Mirrai macOS 安装包构建指南

## 概述

将 Mirrai 打包为自包含的 macOS `.app` + `.dmg`，内嵌 Node.js 运行时和 PostgreSQL 数据库，用户安装后无需任何额外依赖即可使用。

当前仅支持 **Apple Silicon (arm64)**，最低系统要求 **macOS 13.0**。

---

## 前置要求（构建机器）

| 依赖 | 用途 |
|------|------|
| Homebrew | 获取 PostgreSQL 二进制 |
| PostgreSQL 16 (`brew install postgresql@16`) | 复制 bin/lib/share 到 app bundle |
| pnpm | 构建项目 |
| Xcode Command Line Tools | `install_name_tool`、`codesign`、`hdiutil` |

> 这些是**构建时**依赖，最终用户不需要安装任何东西。

---

## 一键构建

```bash
bash scripts/build-macos-app.sh
```

产物：
- `build-macos/Mirrai.app` — 可直接运行的应用
- `build-macos/Mirrai-macOS-arm64.dmg` — 分发用磁盘映像（~800MB）

---

## .app 目录结构

```
Mirrai.app/Contents/
├── MacOS/
│   └── Mirrai                  # 薄启动器（AppleScript 打开 Terminal）
├── Resources/
│   ├── start.sh                # 真正的启动脚本
│   ├── node/bin/node           # Node.js v24.22.1 arm64
│   ├── pgsql/                  # PostgreSQL 16
│   │   ├── bin/                # postgres, pg_ctl, initdb, createdb, psql, pg_isready
│   │   ├── lib/                # 所有 .dylib（含 ICU）
│   │   └── share/              # initdb 所需的配置模板
│   └── app/                    # 应用代码
│       ├── dist/               # esbuild 后端 + Vite 前端
│       ├── node_modules/       # 完整依赖（esbuild --packages=external）
│       ├── drizzle/            # 数据库迁移文件
│       ├── drizzle.config.ts
│       └── package.json
└── Info.plist
```

用户数据目录（运行时自动创建）：

```
~/Library/Application Support/Mirrai/
├── pgdata/          # PostgreSQL 数据
├── uploads/         # 用户上传文件
├── logs/            # postgresql.log, initdb.log, migrate.log
├── .env             # 用户配置（AI provider key 等）
└── .jwt_secret      # 自动生成的 JWT 密钥
```

---

## 构建流程详解

### 1. 项目构建

```bash
pnpm install --frozen-lockfile
pnpm build    # Vite 前端 + esbuild 后端 → dist/
```

### 2. 嵌入 Node.js

从 nodejs.org 下载官方 arm64 二进制，只取 `bin/node`：

```
https://nodejs.org/dist/v24.22.1/node-v24.22.1-darwin-arm64.tar.gz
```

### 3. 嵌入 PostgreSQL

从 Homebrew 安装的 PostgreSQL 16 复制：

**二进制**：`postgres`, `pg_ctl`, `initdb`, `createdb`, `psql`, `pg_isready`

**共享库**：递归收集所有 Homebrew 路径的 dylib 依赖（最多 5 轮迭代扫描 bin/* 和 lib/*.dylib）。

**ICU 数据库**：`libicudata.78.dylib` 通过 dlopen 加载，`otool -L` 看不到，必须从 `brew --prefix icu4c@78` 显式复制。

**share 文件**：initdb 需要 `postgresql@16/share/` 下的配置模板。

### 4. 修复动态库路径

Homebrew 二进制中的 dylib 引用是绝对路径（如 `/opt/homebrew/opt/icu4c@78/lib/libicuuc.78.dylib`），需要改写为相对路径：

```bash
# 二进制 → @executable_path/../lib/
install_name_tool -change "/opt/homebrew/..." "@executable_path/../lib/libXXX.dylib" bin/postgres

# dylib → @loader_path/
install_name_tool -id "@loader_path/libXXX.dylib" lib/libXXX.dylib
install_name_tool -change "/opt/homebrew/..." "@loader_path/libYYY.dylib" lib/libXXX.dylib
```

### 5. 重新签名

`install_name_tool` 会使 adhoc 签名失效，必须重新签名，否则 macOS 会拒绝执行（initdb 会静默挂起）：

```bash
codesign --force --sign - bin/postgres
codesign --force --sign - lib/libXXX.dylib
```

### 6. 验证

确认没有残留的 Homebrew 绝对路径：

```bash
for f in pgsql/bin/* pgsql/lib/*.dylib; do
  otool -L "$f" 2>/dev/null
done | grep -E "^\s+/opt/homebrew"
# 应该无输出
```

### 7. 组装 app bundle

复制 `dist/`、`drizzle/`、`package.json`、`drizzle.config.ts`、完整 `node_modules/` 到 `Resources/app/`。

> **为什么需要完整 node_modules？** esbuild 使用 `--packages=external`，运行时 `require('vite')`、`require('drizzle-kit')` 等必须可解析。

### 8. 打包 DMG

```bash
hdiutil create -volname "Mirrai" -srcfolder dmg-staging/ -ov -format UDZO Mirrai-macOS-arm64.dmg
```

DMG 内含 `Mirrai.app`、`Applications` 快捷方式、`README.txt`。

---

## 启动流程

```
用户双击 Mirrai.app
  → Contents/MacOS/Mirrai（launcher.sh）
    → AppleScript 打开 Terminal.app
      → 执行 Contents/Resources/start.sh
```

**为什么需要 launcher + Terminal？** macOS 直接运行 .app 没有 TTY，shell 脚本的输出不可见，错误时会"闪退"。通过 AppleScript 打开 Terminal 可以让用户看到启动日志。

### start.sh 启动顺序

1. 设置环境变量（`DYLD_LIBRARY_PATH`, `PGSHAREDIR`, `LC_ALL=C`）
2. 首次运行：`initdb` 初始化数据库（locale=C, encoding=UTF8）
3. 配置 `postgresql.conf`（port=5433, unix_socket=/tmp, listen=localhost）
4. `pg_ctl start` 启动 PostgreSQL
5. 查询 `pg_database` 系统表判断数据库是否存在，不存在则 `createdb`
6. 设置 `DATABASE_URL=postgresql://mirrai@localhost:5433/mirrai`
7. 加载用户 `.env` 配置
8. 自动生成 `JWT_SECRET`（如未配置）
9. `drizzle-kit migrate` 运行数据库迁移
10. `node dist/index.js` 启动服务器
11. 等待服务器就绪后 `open http://localhost:3000`
12. trap 注册：退出时停止服务器和 PostgreSQL

---

## 踩过的坑

### initdb 静默挂起

`install_name_tool` 修改二进制后 adhoc 签名失效，macOS 拒绝执行但不报错，initdb 看起来像是卡住了。**必须在修改路径后 `codesign --force --sign -` 重新签名。**

### 缺少 libicudata

PostgreSQL 通过 `dlopen` 加载 ICU 数据库，`otool -L` 不会列出这个依赖。如果只靠 otool 收集依赖会遗漏它。**必须从 `brew --prefix icu4c@78` 显式复制 `libicudata*.dylib`。**

### dylib 的传递依赖

初版只扫描 `bin/*` 的依赖，但 `lib/*.dylib` 自身也依赖其他 Homebrew dylib（如 `libicuuc` → `libicudata`）。**必须同时扫描 bin 和 lib，迭代多轮直到无新增。**

### .app 闪退

macOS 运行 .app 时没有 TTY，shell 脚本的 stdout/stderr 不可见，出错时用户只看到"闪退"。**拆分为 launcher.sh（AppleScript 打开 Terminal）+ start.sh（在 Terminal 中运行）。**

### PostgreSQL unix socket 路径含空格

`~/Library/Application Support/Mirrai/pgdata` 路径含空格，传给 `-o "-k /path/..."` 时会被 shell 拆分。**改为 `unix_socket_directories = '/tmp'`，所有连接走 TCP `localhost:5433`。**

### locale 错误

嵌入的 PostgreSQL 在某些系统上找不到 locale 数据，报 `postmaster became multithreaded` 错误。**设置 `LC_ALL=C` 和 `LANG=C`，initdb 使用 `--locale=C`。**

### createdb 静默失败

原始写法 `createdb ... 2>/dev/null || true` 吞掉了所有错误。而且 `psql -lqt | grep -qw mirrai` 会匹配到 owner 列（因为 initdb 创建的超级用户也叫 mirrai），误判数据库已存在。**改为查询 `pg_database` 系统表精确判断：**

```bash
psql -h localhost -p 5433 -U mirrai -d postgres \
  -tc "SELECT 1 FROM pg_database WHERE datname = 'mirrai';"
```

### node_modules 不完整

生产模式 `npm install --production` 会排除 devDependencies，但 esbuild 使用 `--packages=external`，运行时需要 `vite`、`drizzle-kit` 等 devDependencies。**必须复制完整 node_modules。**

---

## 快速更新流程

如果只改了前端/后端代码，不需要完整重新构建：

```bash
# 1. 重新构建项目
pnpm build

# 2. 更新 app bundle 中的 dist
rm -rf build-macos/Mirrai.app/Contents/Resources/app/dist
cp -R dist build-macos/Mirrai.app/Contents/Resources/app/

# 3. 如果改了 start.sh
cp scripts/macos/start.sh build-macos/Mirrai.app/Contents/Resources/start.sh
chmod +x build-macos/Mirrai.app/Contents/Resources/start.sh

# 4. 重新打包 DMG
DMG_TMP="build-macos/dmg-staging"
rm -rf "$DMG_TMP" build-macos/Mirrai-macOS-arm64.dmg
mkdir -p "$DMG_TMP"
cp -R build-macos/Mirrai.app "$DMG_TMP/"
ln -s /Applications "$DMG_TMP/Applications"
hdiutil create -volname "Mirrai" -srcfolder "$DMG_TMP" -ov -format UDZO build-macos/Mirrai-macOS-arm64.dmg
```

---

## 测试清单

```bash
# 清除旧数据（模拟全新安装）
rm -rf ~/Library/Application\ Support/Mirrai

# 从 app bundle 直接测试（不需要每次装 DMG）
bash build-macos/Mirrai.app/Contents/Resources/start.sh

# 验证项：
# ✓ initdb 成功（首次运行）
# ✓ PostgreSQL 启动（port 5433）
# ✓ 数据库 mirrai 创建成功
# ✓ drizzle 迁移成功
# ✓ 服务器启动（port 3000）
# ✓ 浏览器自动打开
# ✓ 注册/登录正常
# ✓ Ctrl+C 优雅退出（PG 也停止）
# ✓ 第二次启动跳过 initdb，复用已有数据
```

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `scripts/build-macos-app.sh` | 构建脚本（一键打包） |
| `scripts/macos/launcher.sh` | 薄启动器（AppleScript → Terminal） |
| `scripts/macos/start.sh` | 启动脚本（PG + Node + 迁移） |
| `scripts/macos/Info.plist` | macOS 应用元数据 |
| `.gitignore` | 已包含 `build-macos/` |
