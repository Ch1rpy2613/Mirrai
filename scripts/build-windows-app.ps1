# ─── Mirrai Windows Builder ───────────────────────────────────────────────────
# Builds a self-contained Mirrai for Windows with embedded Node.js and
# PostgreSQL, then packages it into a .zip for distribution.
#
# The result is a folder you can unpack anywhere and run by double-clicking
# Mirrai.cmd — no installer, no admin rights, no system-wide changes.
#
# Usage (from the repository root):
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows-app.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = Split-Path -Parent $ScriptDir
$BuildDir = Join-Path $ProjectDir "build-windows"
$AppName = "Mirrai"
$DistName = "Mirrai-Windows-x64"

$NodeVersion = "24.22.1"
$NodeArch = "x64"
$NodeZip = "node-v${NodeVersion}-win-${NodeArch}.zip"
$NodeUrl = "https://nodejs.org/dist/v${NodeVersion}/${NodeZip}"

$PgVersion = "16.4"
$PgUrl = "https://get.enterprisedb.com/postgresql/postgresql-${PgVersion}-1-windows-x64-binaries.zip"

# Redis has no official Windows build. This is the community port that has
# been the Windows Redis for years; the version and the checksum are pinned,
# and the build stops if the archive does not match.
$RedisVersion = "5.0.14.1"
$RedisZip = "Redis-x64-${RedisVersion}.zip"
$RedisUrl = "https://github.com/tporadowski/redis/releases/download/v${RedisVersion}/${RedisZip}"
$RedisSha256 = "018ea18a35876383cbb5f4cd0258adfc87747cf9d619bce1cf73a2e36f720ccf"

function Log($msg) { Write-Host "==> $msg" }
function Die($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# ─── Preflight ───────────────────────────────────────────────────────────────
Log "Checking prerequisites..."
foreach ($cmd in @("node", "pnpm", "tar", "robocopy")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Die "$cmd is required but was not found on PATH."
    }
}

# ─── Clean previous build ────────────────────────────────────────────────────
Log "Cleaning previous build..."
if (Test-Path $BuildDir) { Remove-Item $BuildDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

$DistDir = Join-Path $BuildDir $DistName
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# ─── Step 1: Build the project ───────────────────────────────────────────────
Log "Building Mirrai project..."
Push-Location $ProjectDir
try {
    # The hoisted linker produces a flat node_modules without pnpm's .pnpm
    # directory. That is not just tidier: the .pnpm paths run past the limit
    # that Windows APIs accept, and the installer cannot read them.
    if (Test-Path (Join-Path $ProjectDir "node_modules")) {
        Log "Removing the previous node_modules..."
        # rmdir handles the junctions and read-only files that Remove-Item
        # leaves behind, and pnpm will not rearrange an existing tree.
        cmd /c rmdir /s /q node_modules 2>&1 | Out-Null
        if (Test-Path (Join-Path $ProjectDir "node_modules")) {
            Remove-Item (Join-Path $ProjectDir "node_modules") -Recurse -Force
        }
    }
    corepack pnpm install --frozen-lockfile --node-linker=hoisted
    Log "node-linker in effect: $(corepack pnpm config get node-linker)"
    # With the hoisted linker the top level is a plain npm-style tree and
    # .pnpm is only the store it was built from. Its paths are the long ones
    # that Windows refuses to open, and nothing refers to them afterwards.
    if (Test-Path (Join-Path $ProjectDir "node_modules\.pnpm")) {
        Log "Removing the pnpm virtual store..."
        cmd /c rmdir /s /q node_modules\.pnpm 2>&1 | Out-Null
        if (Test-Path (Join-Path $ProjectDir "node_modules\.pnpm")) {
            Remove-Item (Join-Path $ProjectDir "node_modules\.pnpm") -Recurse -Force
        }
    }
    # Drop packages that are no longer in the dependency tree; pnpm would
    # otherwise keep them around and they would be shipped inside the bundle.
    corepack pnpm prune
    corepack pnpm build
} finally {
    Pop-Location
}

# ─── Step 2: Download Node.js ────────────────────────────────────────────────
Log "Downloading Node.js v${NodeVersion} (${NodeArch})..."
$NodeZipPath = Join-Path $BuildDir $NodeZip
if (-not (Test-Path $NodeZipPath)) {
    Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZipPath
}
Expand-Archive -Path $NodeZipPath -DestinationPath (Join-Path $BuildDir "node-tmp") -Force
# The archive unpacks into a "node-v<version>-win-<arch>" directory; take its
# contents, not the directory itself.
$NodeSrc = Join-Path $BuildDir "node-tmp\node-v${NodeVersion}-win-${NodeArch}"
if (-not (Test-Path (Join-Path $NodeSrc "node.exe"))) {
    Die "Could not find node.exe in the downloaded Node.js archive."
}
New-Item -ItemType Directory -Force -Path (Join-Path $DistDir "node") | Out-Null
Copy-Item -Path (Join-Path $NodeSrc "*") -Destination (Join-Path $DistDir "node") -Recurse -Force
Remove-Item (Join-Path $BuildDir "node-tmp") -Recurse -Force
Log "Node.js binary ready."

# ─── Step 3: PostgreSQL ──────────────────────────────────────────────────────
Log "Downloading PostgreSQL ${PgVersion} (${NodeArch})..."
$PgZipPath = Join-Path $BuildDir "postgresql-win.zip"
if (-not (Test-Path $PgZipPath)) {
    Invoke-WebRequest -Uri $PgUrl -OutFile $PgZipPath
}
Log "Extracting PostgreSQL..."
Expand-Archive -Path $PgZipPath -DestinationPath (Join-Path $BuildDir "pg-tmp") -Force

# The archive unpacks into a top-level "pgsql" directory; tolerate an archive
# that puts the binaries at the root instead.
$PgSrc = Join-Path $BuildDir "pg-tmp\pgsql"
if (-not (Test-Path (Join-Path $PgSrc "bin"))) {
    $PgSrc = Join-Path $BuildDir "pg-tmp"
}
if (-not (Test-Path (Join-Path $PgSrc "bin"))) {
    Die "Could not find the PostgreSQL bin directory in the downloaded archive."
}

$PgDest = Join-Path $DistDir "pgsql"
New-Item -ItemType Directory -Force -Path $PgDest | Out-Null
foreach ($sub in @("bin", "lib", "share")) {
    $from = Join-Path $PgSrc $sub
    if (Test-Path $from) {
        Copy-Item -Path $from -Destination $PgDest -Recurse -Force
    }
}

# The archive already ships the runtime DLLs (libcrypto, libssl, libintl,
# libiconv, libxml2, ...) next to the executables in bin\, so nothing has to be
# moved around. lib\ is kept because it holds the extension modules that
# share\extension refers to.
$dllCount = @(Get-ChildItem (Join-Path $PgDest "bin") -Filter "*.dll" -ErrorAction SilentlyContinue).Count
if ($dllCount -lt 1) {
    Die "The PostgreSQL bin directory contains no DLLs — the archive looks unexpected."
}
Log "Found $dllCount runtime DLLs next to the PostgreSQL executables."

Remove-Item (Join-Path $BuildDir "pg-tmp") -Recurse -Force
Remove-Item $PgZipPath -Force
Log "PostgreSQL binaries ready."

# ─── Step 3b: Redis ──────────────────────────────────────────────────────────
# The rate limiter and the scheduler lock live in Redis, so a person who
# installs Mirrai has to end up with one. Bundling it here is what makes that
# true: the app finds this binary and starts it itself, and the person never
# has to install, download or configure anything.
#
# Redis has no official Windows build, so this is the community port that
# has been the Windows Redis for years. The version and the checksum are
# pinned: the archive is only unpacked if it hashes to exactly this, so a
# changed or substituted download stops the build rather than shipping.
Log "Downloading Redis ${RedisVersion} (${NodeArch})..."
$RedisZipPath = Join-Path $BuildDir "redis-win.zip"
if (-not (Test-Path $RedisZipPath)) {
    Invoke-WebRequest -Uri $RedisUrl -OutFile $RedisZipPath
}

Log "Checking the Redis archive..."
$RedisHash = (Get-FileHash -Path $RedisZipPath -Algorithm SHA256).Hash.ToLower()
if ($RedisHash -ne $RedisSha256) {
    Die "The Redis archive does not match the pinned checksum.`n  expected: $RedisSha256`n  actual:   $RedisHash"
}
Log "Redis archive verified (sha256 $RedisHash)."

Log "Extracting Redis..."
$RedisTmp = Join-Path $BuildDir "redis-tmp"
Expand-Archive -Path $RedisZipPath -DestinationPath $RedisTmp -Force

$RedisDest = Join-Path $DistDir "redis"
New-Item -ItemType Directory -Force -Path $RedisDest | Out-Null

# Only the two executables that are actually used are kept, plus the DLLs
# they load. The .pdb files are debug symbols — fifteen megabytes of nothing
# a person will ever look at — and the other tools (benchmark, check-aof,
# check-rdb) are not something a person running a companion app needs.
foreach ($exe in @("redis-server.exe", "redis-cli.exe")) {
    $from = Get-ChildItem -Path $RedisTmp -Filter $exe -File -Recurse | Select-Object -First 1
    if (-not $from) { Die "$exe is missing from the Redis archive." }
    Copy-Item -Path $from.FullName -Destination $RedisDest -Force
}
foreach ($dll in Get-ChildItem -Path $RedisTmp -Filter "*.dll" -File -Recurse) {
    Copy-Item -Path $dll.FullName -Destination $RedisDest -Force
}

if (-not (Test-Path (Join-Path $RedisDest "redis-server.exe"))) {
    Die "redis-server.exe is missing from the Redis archive."
}

Remove-Item $RedisTmp -Recurse -Force
Remove-Item $RedisZipPath -Force
Log "Redis binaries ready."

# ─── Step 4: Assemble app code ───────────────────────────────────────────────
Log "Copying application code..."
$AppDest = Join-Path $DistDir "app"
New-Item -ItemType Directory -Force -Path $AppDest | Out-Null

Copy-Item -Path (Join-Path $ProjectDir "dist") -Destination $AppDest -Recurse -Force
Copy-Item -Path (Join-Path $ProjectDir "drizzle") -Destination $AppDest -Recurse -Force
Copy-Item -Path (Join-Path $ProjectDir "package.json") -Destination $AppDest -Force
Copy-Item -Path (Join-Path $ProjectDir "drizzle.config.ts") -Destination $AppDest -Force

# The templates that ship with the app. Without them the template
# library is empty and "try it out with a sandbox character" is
# impossible.
New-Item -ItemType Directory -Force -Path (Join-Path $AppDest "server\templates") | Out-Null
Copy-Item -Path (Join-Path $ProjectDir "server\templates\builtin") -Destination (Join-Path $AppDest "server\templates") -Recurse -Force

# The skill engine: the prompts the distillation reads at run time, and
# the Python collectors it drives.
#
# They were never shipped, so in the installed app every distillation
# stage failed with "Prompt not found" and the collectors were spawned
# in a directory that did not exist.
Copy-Item -Path (Join-Path $ProjectDir "skill-engine") -Destination (Join-Path $AppDest "skill-engine") -Recurse -Force

# The migration runner. The start script runs it out of the bundle, and
# it was not there — so the hand-written data migrations never ran on
# an installed app.
New-Item -ItemType Directory -Force -Path (Join-Path $AppDest "scripts") | Out-Null
Copy-Item -Path (Join-Path $ProjectDir "scripts\migrate.mjs") -Destination (Join-Path $AppDest "scripts\migrate.mjs") -Force

# The esbuild bundle uses --packages=external, so runtime imports like vite and
# drizzle-kit must stay resolvable. node_modules was installed with the hoisted
# linker, so it is a plain directory tree and copies without following links.
Log "Copying node_modules (this may take a moment)..."
$rc = Start-Process -FilePath "robocopy" `
    -ArgumentList @((Join-Path $ProjectDir "node_modules"), (Join-Path $AppDest "node_modules"), "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/XD", ".vscode", ".idea") `
    -Wait -PassThru -NoNewWindow
# robocopy exits with 0-7 on success.
if ($rc.ExitCode -ge 8) {
    Die "robocopy failed with exit code $($rc.ExitCode)."
}

# ─── Step 5: Launcher + start script ─────────────────────────────────────────
Log "Writing launcher and start scripts..."
Copy-Item -Path (Join-Path $ScriptDir "windows\start.ps1") -Destination (Join-Path $DistDir "start.ps1") -Force
Copy-Item -Path (Join-Path $ScriptDir "windows\Mirrai.cmd") -Destination (Join-Path $DistDir "Mirrai.cmd") -Force

# ─── Step 5b: GUI launcher ──────────────────────────────────────────────────
# The GUI launcher is what a person actually double-clicks. It needs the .NET
# SDK to build, so it is skipped when that is not available - the bundle is
# still usable through Mirrai.cmd.
$LauncherProject = Join-Path $ScriptDir "windows\launcher\Mirrai.Launcher.csproj"
if (Get-Command dotnet -ErrorAction SilentlyContinue) {
    Log "Building the GUI launcher..."
    $LauncherOut = Join-Path $BuildDir "launcher-out"
    & dotnet publish $LauncherProject -c Release -r win-x64 --self-contained true `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:EnableCompressionInSingleFile=true `
        -o $LauncherOut
    if ($LASTEXITCODE -ne 0) { Die "The GUI launcher failed to build." }
    Copy-Item -Path (Join-Path $LauncherOut "Mirrai.exe") -Destination (Join-Path $DistDir "Mirrai.exe") -Force
    Log "GUI launcher ready."
} else {
    Log "The .NET SDK was not found, skipping the GUI launcher (Mirrai.cmd still works)."
}

$readme = @"
Mirrai - AI Digital Persona Platform

Installation:
  Unpack this folder anywhere you like (for example C:\Mirrai).
  Nothing is installed system-wide and no administrator rights are needed.
  Everything Mirrai needs is in this folder: Node.js, PostgreSQL and Redis.
  There is nothing else to download and nothing to configure.

First Launch:
  1. Double-click Mirrai.cmd
  2. A console window opens and shows the startup log
  3. Your browser opens automatically at http://localhost:3000
  4. Register an account and start using Mirrai
  The first launch initializes the bundled database and takes a little longer.

Configuration:
  After the first launch, edit the config file at:
  %APPDATA%\Mirrai\.env

  Add your AI provider API key (OpenAI, DeepSeek, Claude, etc.)
  Then close Mirrai.cmd and run it again for the change to take effect.

To Stop:
  Press Ctrl+C in the console window, or just close it.

Notes:
  - Redis comes with Mirrai. It is started automatically when the app starts
    and stopped when it stops; it is what makes the rate limits mean the same
    thing when you run more than one copy.
  - PostgreSQL refuses to run under an Administrator account on Windows.
    If you launched Mirrai.cmd from an elevated prompt, run it as a normal user.
  - The data (database, uploads, logs) lives in %APPDATA%\Mirrai, so
    uninstalling is just deleting that folder plus this one.
"@
Set-Content -Path (Join-Path $DistDir "README.txt") -Value $readme -Encoding UTF8

# ─── Step 6: Package ─────────────────────────────────────────────────────────
Log "Creating ZIP..."
$ZipPath = Join-Path $BuildDir "$DistName.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Push-Location $BuildDir
try {
    tar -a -c -f $ZipPath $DistName
} finally {
    Pop-Location
}
if (-not (Test-Path $ZipPath)) { Die "The archive was not created." }

$zipSize = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
Log ""
Log "Build complete!"
Log "  Folder: $DistDir"
Log "  ZIP:    $ZipPath ($zipSize MB)"
Log ""
Log "To test: unpack the ZIP and run Mirrai.cmd"
