# Mirrai Windows 安装包构建指南

## 概述

将 Mirrai 打包为自包含的 Windows 安装程序，内嵌 Node.js 运行时和 PostgreSQL 数据库，用户安装后无需任何额外依赖即可使用。

产物有两个：

| 文件 | 说明 |
|------|------|
| `Mirrai.exe` | GUI 启动器，用户双击的就是它。WinForms 自绘窗口，带进度条 |
| `Mirrai-Setup-x64.exe` | Inno Setup 安装包，把上面所有东西装到用户目录并创建快捷方式 |

当前仅支持 **Windows x64**。

---

## 前置要求（构建机器）

| 依赖 | 用途 |
|------|------|
| pnpm | 构建项目 |
| .NET SDK 8 | 编译 GUI 启动器 |
| Inno Setup 6 | 生成安装包 |
| PostgreSQL 16 Windows 二进制 | 复制 bin/lib/share 到安装目录 |

> 这些是**构建时**依赖，最终用户不需要安装任何东西。

---

## 一键构建

```powershell
# 构建完整 bundle（含 GUI 启动器）
powershell -ExecutionPolicy Bypass -File scripts\build-windows-app.ps1

# 生成安装包
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" installer\installer.iss
```

在 CI 上两者都由 `.github/workflows/release.yml` 完成：打 `v*` tag 就会构建两个平台并把产物挂到 Release。

---

## 安装目录结构

```
Mirrai-Windows-x64/
├── Mirrai.exe            ← GUI 启动器（用户双击的）
├── Mirrai.cmd            ← 命令行退路
├── start.ps1             ← 真正的启动脚本
├── node/
│   └── node.exe
├── pgsql/
│   ├── bin/              ← postgres.exe, initdb.exe, psql.exe + 运行时 DLL
│   ├── lib/              ← 扩展模块
│   └── share/            ← initdb 需要的 postgres.bki 等
└── app/
    ├── dist/             ← 服务端产物
    ├── drizzle/          ← Schema 与手写迁移
    ├── node_modules/     ← 运行时依赖（扁平布局）
    └── package.json
```

---

## 构建流程详解

### 1. 项目构建

```powershell
corepack pnpm install --frozen-lockfile --node-linker=hoisted
corepack pnpm prune
corepack pnpm build
```

`--node-linker=hoisted` 不是可选项，原因见下面的「踩过的坑」。

### 2. 嵌入 Node.js

下载 `node-v24.22.1-win-x64.zip`，解压后把**内容**（不是目录本身）放进 `node/`。

### 3. 嵌入 PostgreSQL

从 EnterpriseDB 下载 `postgresql-16.4-1-windows-x64-binaries.zip`，只取 `bin/`、`lib/`、`share/` 三个目录。

**不需要**像 macOS 那样手动收集 DLL —— Windows 版的运行时 DLL（`libcrypto-3-x64.dll`、`libssl-3-x64.dll`、`libintl-9.dll`、`libiconv-2.dll`、`libxml2.dll`、`libzstd.dll`、ICU 系列）本来就在 `bin/` 里。

### 4. GUI 启动器

```powershell
dotnet publish scripts\windows\launcher\Mirrai.Launcher.csproj `
    -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -o build-windows\launcher-out
```

`--self-contained` 让用户机器不需要装 .NET，产物是一个独立的 exe。

### 5. 生成安装包

`installer/installer.iss` 里 `PrivilegesRequired=lowest`，所以装进 `%LOCALAPPDATA%\Programs\Mirrai`，不需要管理员权限。

---

## 启动流程

```
用户双击 Mirrai.exe（GUI 启动器）
  → 启动 powershell -File start.ps1，实时读取它的输出
    → 按日志里的阶段标记推进进度条
      → 就绪后自动打开浏览器
```

GUI 启动器把 `start.ps1` 的 `[Mirrai] ...` 日志映射成 11 个阶段：

| 阶段 | 进度 |
|------|------|
| Mirrai is starting | 5% |
| Initializing database | 15% |
| Database initialized | 30% |
| Starting PostgreSQL | 40% |
| PostgreSQL started | 55% |
| Ensuring database | 60% |
| Applying the WeChat channel migration | 68% |
| Synchronizing the database schema | 78% |
| Created config at | 85% |
| Starting Mirrai server | 90% |
| Mirrai is running at | 100% |

首次启动要初始化数据库，可能需要一两分钟 —— 这个进度条就是为此存在的。

### start.ps1 启动顺序

1. 设置环境变量（`PATH` 加上 `pgsql\bin` 和 `node`，`TEMP`/`HOME` 指向可写目录）
2. 首次运行：`initdb` 初始化数据库（locale=C, encoding=UTF8）
3. 配置 `postgresql.conf`（port=5433, listen=localhost）
4. `pg_ctl start` 启动 PostgreSQL
5. 查询 `pg_database` 判断数据库是否存在，不存在则 `createdb`
6. 设置 `DATABASE_URL=postgresql://mirrai@localhost:5433/mirrai`
7. 加载用户 `.env` 配置
8. 自动生成 `JWT_SECRET`（如未配置）
9. 微信通道迁移（仅当 `wechat_bindings` 表已存在时才跑）
10. `drizzle-kit push --force` 同步表结构
11. `node dist/index.js` 启动服务器
12. 等待就绪后自动打开浏览器

---

## 冒烟测试

`scripts/windows/smoke-test.ps1` 会在 CI 上把打包好的 bundle 真的跑起来：

- 用**普通用户**执行（PostgreSQL 拒绝以管理员身份运行）
- `initdb` → `pg_ctl start` → `createdb` → `drizzle-kit push` → 检查表数量 → 起服务器 → 确认 HTTP 有响应

这不只是检查文件在不在，是验证"用户双击之后真的会跑起来"。

---

## 踩过的坑

### pnpm 的 .pnpm 目录路径太长

`.pnpm/<pkg>@<version>_<hash>/node_modules/<pkg>/...` 轻松超过 260 字符，Inno Setup 打开这些文件时直接报「The system cannot find the path specified」。

**必须用 `--node-linker=hoisted`**，并且**先把旧的 `node_modules` 删掉** —— pnpm 不会重排已有的目录树。`Remove-Item` 删不干净 pnpm 的 junction，要用 `cmd /c rmdir /s /q`。

hoisted 之后 `.pnpm` 仍然存在（那是 store），但顶层已经是 npm 风格的实体目录，**把 `.pnpm` 删掉即可**，长路径问题彻底消失。

### 编译路径里的 `..`

`Source: "..\build-windows\..."` 会把 `..` 原样拼进每一个文件名的中间。**CI 里用 `/D` 传绝对路径**（`/DMyAppBundle=...`），脚本里用 `#ifndef` 保护。

### Inno Setup 自带的 Setup.ico 缺失

choco 装的 Inno Setup 不一定带齐资源文件，编译会在「Updating icons (Setup.exe)」那一步挂掉。**项目自带 `installer/mirrai.ico`（由 `scripts/windows/make-icon.py` 生成），并在 `.iss` 里用 `SetupIconFile` 指定。**

### pg_ctl 的管道挂死

```powershell
& pg_ctl.exe ... start 2>&1 | Out-Null    # ❌ 永久挂起
```

postgres 会继承管道的写端，管道永远等不到 EOF。**改用 `Start-Process` 把输出重定向到文件。**

### Start-Process -Wait 等整个进程树

```powershell
Start-Process pg_ctl.exe ... -Wait          # ❌ 连常驻的 postgres 一起等
```

`-Wait` 等的是进程树。常驻的数据库永远不退出，所以也会挂死。**去掉 `-Wait`，改用 `pg_isready` 轮询判断就绪。**

### 管理员身份下 PostgreSQL 拒绝启动

Windows 版 PostgreSQL 不允许以管理员身份运行数据目录。**冒烟测试必须降权到普通用户**（`Start-Process -Credential`）。

### PowerShell 5.1 的输出是系统代码页

GUI 启动器按 UTF-8 解码 stdout，但 PowerShell 5.1 默认写 GBK。**在 start.ps1 开头设置 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`。**

### psql 写 stderr 会变成终止性错误

`$ErrorActionPreference = "Stop"` 时，psql 的 stderr 输出会被 PowerShell 变成 error record 并中断脚本。**预期的失败（全新库里跑增量迁移）要用 try/catch 明确吞掉。**

### drizzle-kit migrate 需要迁移 journal

`drizzle-kit migrate` 依赖 `drizzle/meta/_journal.json`，而那个目录被 gitignore，桌面包里根本没有 → **migrate 每台机器上都失败，表建不出来**。

**改用 `drizzle-kit push --force`**：它直接对比 `schema.ts` 和数据库实际结构，不需要 journal。

---

## 快速更新流程

如果只改了前端/后端代码，不需要完整重新构建：

```powershell
corepack pnpm build
Copy-Item dist build-windows\Mirrai-Windows-x64\app\ -Recurse -Force
```

GUI 启动器和安装包只有改了 `scripts/windows/` 或 `installer/` 时才需要重做。
