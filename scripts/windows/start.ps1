# Mirrai — Windows startup script
#
# Starts the bundled PostgreSQL and the Mirrai server, then opens the browser.
# Mirrors scripts/macos/start.sh; the layout next to this file is expected to
# be: node\node.exe, pgsql\bin, app\dist\index.js
#
# Run it through Mirrai.cmd (double-click) or:
#   powershell -ExecutionPolicy Bypass -File start.ps1

$ErrorActionPreference = "Stop"

$Res     = Split-Path -Parent $MyInvocation.MyCommand.Definition
$NodeBin = Join-Path $Res "node\node.exe"
$PgDir   = Join-Path $Res "pgsql"
$AppDir  = Join-Path $Res "app"

$DataRoot = Join-Path $env:APPDATA "Mirrai"
$PgData   = Join-Path $DataRoot "pgdata"
$Uploads  = Join-Path $DataRoot "uploads"
$Logs     = Join-Path $DataRoot "logs"
$PgLog    = Join-Path $Logs "postgresql.log"
$PgPort   = 5433
$PgUser   = "mirrai"
$DbName   = "mirrai"

# The PostgreSQL binaries ship their DLLs in lib\. They are copied next to the
# executables at build time, so putting bin\ on PATH is enough.
$env:PATH = "$PgDir\bin;$Res\node;$env:PATH"

$script:Server = $null

function Log($msg) {
    Write-Host "[Mirrai] $msg"
}

function Cleanup {
    Log "Shutting down..."
    if ($script:Server) {
        try { Stop-Process -Id $script:Server.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    if (Test-Path (Join-Path $PgData "postmaster.pid")) {
        try { & (Join-Path $PgDir "bin\pg_ctl.exe") -D $PgData -m fast stop 2>&1 | Out-Null } catch {}
    }
    Log "Stopped. You can close this window."
}

Write-Host ""
Write-Host "  =========================================="
Write-Host "            Mirrai is starting..."
Write-Host "  =========================================="
Write-Host ""

try {
    # ─── Ensure data directories ────────────────────────────────────────────
    New-Item -ItemType Directory -Force -Path $PgData, $Uploads, $Logs | Out-Null

    # ─── PostgreSQL: init if needed ─────────────────────────────────────────
    if (-not (Test-Path (Join-Path $PgData "PG_VERSION"))) {
        Log "Initializing database (first run)..."
        $initLog = Join-Path $Logs "initdb.log"
        & (Join-Path $PgDir "bin\initdb.exe") `
            -D $PgData `
            -U $PgUser `
            -A trust `
            --encoding=UTF8 `
            --locale=C *>&1 | Tee-Object -FilePath $initLog

        if ($LASTEXITCODE -ne 0) {
            Log "ERROR: Database init failed. Log: $initLog"
            Read-Host "Press Enter to exit..."
            exit 1
        }

        Add-Content -Path (Join-Path $PgData "postgresql.conf") -Value @"
port = $PgPort
listen_addresses = 'localhost'
"@
        Log "Database initialized."
    }

    # ─── PostgreSQL: start ──────────────────────────────────────────────────
    if (Test-Path (Join-Path $PgData "postmaster.pid")) {
        & (Join-Path $PgDir "bin\pg_isready.exe") -h localhost -p $PgPort -q 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Log "PostgreSQL already running."
        } else {
            Log "Cleaning stale PID file..."
            Remove-Item (Join-Path $PgData "postmaster.pid") -Force -ErrorAction SilentlyContinue
        }
    }

    if (-not (Test-Path (Join-Path $PgData "postmaster.pid"))) {
        Log "Starting PostgreSQL on port $PgPort..."
        & (Join-Path $PgDir "bin\pg_ctl.exe") -D $PgData -l $PgLog start 2>&1 | Out-Null

        $ready = $false
        for ($i = 0; $i -lt 30; $i++) {
            & (Join-Path $PgDir "bin\pg_isready.exe") -h localhost -p $PgPort -q 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
            Start-Sleep -Seconds 1
        }
        if (-not $ready) {
            Log "ERROR: PostgreSQL failed to start. Log:"
            if (Test-Path $PgLog) { Get-Content $PgLog -Tail 20 | Write-Host }
            Read-Host "Press Enter to exit..."
            exit 1
        }
        Log "PostgreSQL started."
    }

    # ─── Create database if needed ──────────────────────────────────────────
    Log "Ensuring database '$DbName' exists..."
    $check = & (Join-Path $PgDir "bin\psql.exe") -h localhost -p $PgPort -U $PgUser -d postgres `
        -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName';"

    if ($check -match "1") {
        Log "Database '$DbName' already exists."
    } else {
        Log "Creating database '$DbName'..."
        & (Join-Path $PgDir "bin\createdb.exe") -h localhost -p $PgPort -U $PgUser $DbName
        if ($LASTEXITCODE -ne 0) {
            & (Join-Path $PgDir "bin\psql.exe") -h localhost -p $PgPort -U $PgUser -d postgres `
                -c "CREATE DATABASE $DbName;"
            if ($LASTEXITCODE -ne 0) {
                Log "ERROR: Could not create database '$DbName'."
                if (Test-Path $PgLog) { Get-Content $PgLog -Tail 5 | Write-Host }
                Read-Host "Press Enter to exit..."
                exit 1
            }
        }
        Log "Database '$DbName' created."
    }

    # ─── Environment ────────────────────────────────────────────────────────
    $env:DATABASE_URL = "postgresql://${PgUser}@localhost:${PgPort}/${DbName}"
    $env:NODE_ENV = "production"
    $env:PORT = 3000
    $env:UPLOAD_DIR = $Uploads

    $EnvFile = Join-Path $DataRoot ".env"
    if (Test-Path $EnvFile) {
        foreach ($line in Get-Content $EnvFile) {
            $line = $line.Trim()
            if (-not $line -or $line.StartsWith("#")) { continue }
            $idx = $line.IndexOf("=")
            if ($idx -lt 1) { continue }
            $key = $line.Substring(0, $idx).Trim()
            $val = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }

    if (-not $env:JWT_SECRET) {
        $secretFile = Join-Path $DataRoot ".jwt_secret"
        if (-not (Test-Path $secretFile)) {
            $bytes = New-Object byte[] 32
            [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
            $hex = -join ($bytes | ForEach-Object { $_.ToString("x2") })
            Set-Content -Path $secretFile -Value $hex -NoNewline
        }
        $env:JWT_SECRET = (Get-Content $secretFile -Raw).Trim()
    }

    # ─── Database migration ─────────────────────────────────────────────────
    # The WeChat channel changed the meaning of the binding table, so the
    # hand-written migration runs first. It is idempotent, and on a fresh
    # database it simply fails because the table is not there yet.
    Log "Applying the WeChat channel migration..."
    $migration = Join-Path $AppDir "drizzle\0002_wechat_clawbot_channel.sql"
    if (Test-Path $migration) {
        & (Join-Path $PgDir "bin\psql.exe") -h localhost -p $PgPort -U $PgUser -d $DbName `
            --single-transaction -v ON_ERROR_STOP=1 -f $migration *>&1 |
            Tee-Object -FilePath (Join-Path $Logs "migrate.log")
        if ($LASTEXITCODE -ne 0) {
            Log "Migration note: the schema was not there yet, it will be created below."
        }
    }

    # `drizzle-kit push` compares schema.ts against the live database and
    # applies the difference. Unlike `migrate` it does not need a migration
    # journal, which is not shipped with the app.
    Log "Synchronizing the database schema..."
    Push-Location $AppDir
    try {
        & $NodeBin ".\node_modules\drizzle-kit\bin.cjs" push --force 2>&1 |
            Tee-Object -FilePath (Join-Path $Logs "migrate.log")
    } catch {
        Log "Schema sync note: $($_.Exception.Message)"
    }
    Pop-Location

    # ─── Create .env template for user ──────────────────────────────────────
    if (-not (Test-Path $EnvFile)) {
        @"
# Mirrai Configuration
# Edit this file to configure your AI provider.
# After editing, restart Mirrai for changes to take effect.

# AI Provider (at least one required)
# Options: openai, deepseek, claude, kimi, ollama, tongyi, doubao, 302ai, dify, xunfei
DEFAULT_LLM_PROVIDER=openai
OPENAI_API_KEY=

# DeepSeek (alternative)
# DEEPSEEK_API_KEY=

# Claude (alternative)
# CLAUDE_API_KEY=
"@ | Set-Content -Path $EnvFile -Encoding UTF8
        Log "Created config at: $EnvFile"
    }

    # ─── Start server ───────────────────────────────────────────────────────
    Log "Starting Mirrai server..."
    Push-Location $AppDir
    $script:Server = Start-Process -FilePath $NodeBin -ArgumentList "dist\index.js" `
        -WorkingDirectory $AppDir -PassThru -NoNewWindow
    Pop-Location

    $up = $false
    for ($i = 0; $i -lt 20; $i++) {
        try {
            Invoke-WebRequest -Uri "http://localhost:3000/" -UseBasicParsing -TimeoutSec 2 | Out-Null
            $up = $true
            break
        } catch { Start-Sleep -Seconds 1 }
    }

    Start-Process "http://localhost:3000"

    Write-Host ""
    Log "Mirrai is running at http://localhost:3000"
    Log "Config: $EnvFile"
    Write-Host ""
    Log "Press Ctrl+C or close this window to stop."
    Write-Host ""

    while ($null -ne $script:Server -and -not $script:Server.HasExited) {
        Start-Sleep -Seconds 1
    }
}
finally {
    Cleanup
}
