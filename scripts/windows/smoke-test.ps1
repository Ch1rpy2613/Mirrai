# ─── Mirrai Windows smoke test ───────────────────────────────────────────────
# Verifies that the built bundle actually runs: the PostgreSQL binaries load
# their DLLs, the database can be initialised and started, and the server
# answers on HTTP.
#
# PostgreSQL refuses to run under an Administrator account on Windows, so the
# database part is executed as a freshly created standard user. That is also
# exactly the situation a person unpacking the ZIP is in.
#
# Usage (from the repository root, after the build):
#   powershell -ExecutionPolicy Bypass -File scripts\windows\smoke-test.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$DistDir = Join-Path $ProjectDir "build-windows\Mirrai-Windows-x64"

if (-not (Test-Path $DistDir)) {
    Write-Host "ERROR: $DistDir not found. Run scripts\build-windows-app.ps1 first." -ForegroundColor Red
    exit 1
}

$TestUser = "mirraismoke"
$TestPass = "Mirrai-Smoke-2024!"
# The worker needs a place to write its log. C:\Users\Public always exists, and
# the ACL is adjusted below so a standard user can write there.
$PublicDir = Join-Path $env:PUBLIC "mirrai-smoke"
$WorkerScript = Join-Path $PublicDir "worker.ps1"
$WorkerLog = Join-Path $PublicDir "worker.log"

function Log($msg) { Write-Host "==> $msg" }
function Die($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# ─── 1. The launch script must at least parse ────────────────────────────────
Log "Parsing start.ps1..."
try {
    $null = [ScriptBlock]::Create((Get-Content (Join-Path $DistDir "start.ps1") -Raw))
} catch {
    Die "start.ps1 does not parse: $($_.Exception.Message)"
}
Log "start.ps1 parses."

# ─── 2. The binaries must load ───────────────────────────────────────────────
$NodeBin = Join-Path $DistDir "node\node.exe"
$PgBin = Join-Path $DistDir "pgsql\bin"

Log "Checking the bundled Node.js..."
$nodeVersion = & $NodeBin --version
if ($LASTEXITCODE -ne 0) { Die "node.exe failed to run." }
Log "node.exe $nodeVersion"

Log "Checking the bundled PostgreSQL..."
foreach ($exe in @("postgres.exe", "initdb.exe", "pg_ctl.exe", "psql.exe", "createdb.exe")) {
    $path = Join-Path $PgBin $exe
    if (-not (Test-Path $path)) { Die "$exe is missing from the bundle." }
    $out = & $path --version 2>&1
    if ($LASTEXITCODE -ne 0) { Die "$exe failed to run: $out" }
}
Log "PostgreSQL binaries load their DLLs."

# ─── 3. Run the database and the server as a standard user ───────────────────
if (Get-LocalUser -Name $TestUser -ErrorAction SilentlyContinue) {
    Remove-LocalUser -Name $TestUser
}
$secure = ConvertTo-SecureString $TestPass -AsPlainText -Force
New-LocalUser -Name $TestUser -Password $secure -PasswordNeverExpires | Out-Null
Log "Created standard user '$TestUser'."

# The runner's working directory is not readable by a standard user, and
# C:\Users\Public is not writable by one either. Grant exactly what the
# worker needs: read access to the bundle, and a place to write its log.
$WorkerDir = Split-Path -Parent $WorkerLog
New-Item -ItemType Directory -Force -Path $WorkerDir | Out-Null
& icacls.exe $WorkerDir /grant "${TestUser}:(OI)(CI)F" | Out-Null
& icacls.exe (Split-Path -Parent $DistDir) /grant "${TestUser}:(OI)(CI)RX" | Out-Null
& icacls.exe $DistDir /grant "${TestUser}:(OI)(CI)RX" | Out-Null
Log "Granted the standard user access to the bundle and the log directory."

$worker = @'
$ErrorActionPreference = "Stop"
$dist = $args[0]
$log = $args[1]
$workRoot = $args[2]
$nodeBin = Join-Path $dist "node\node.exe"
$pgBin = Join-Path $dist "pgsql\bin"
$pgData = Join-Path $workRoot "pgdata"
$uploads = Join-Path $workRoot "uploads"
$pgLog = Join-Path $workRoot "pg.log"
$port = 55433

# A process started with -Credential gets a fresh environment that may point
# at a profile the account cannot write to. Point everything at the directory
# that was granted access, because both initdb and Node need a writable home.
$env:TEMP = $workRoot
$env:TMP = $workRoot
$env:TMPDIR = $workRoot
$env:HOME = $workRoot
$env:USERPROFILE = $workRoot
$env:LOCALAPPDATA = $workRoot
$env:APPDATA = $workRoot
# drizzle-kit shells out to the PostgreSQL client tools when it inspects a
# database, so they have to be reachable.
$env:PATH = "$pgBin;$env:PATH"

function Say($m) { "$((Get-Date).ToString('HH:mm:ss')) $m" | Tee-Object -FilePath $log -Append }

try {
    Say "working in $workRoot"
    Remove-Item $pgData -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $pgData, $uploads | Out-Null

    Say "initdb..."
    & (Join-Path $pgBin "initdb.exe") -D $pgData -U mirrai -A trust --encoding=UTF8 --locale=C *>&1 |
        Out-File -FilePath $log -Append
    if ($LASTEXITCODE -ne 0) { Say "initdb FAILED"; exit 1 }
    Say "initdb OK"

    Add-Content -Path (Join-Path $pgData "postgresql.conf") -Value "port = $port`nlisten_addresses = 'localhost'"

    Say "pg_ctl start..."
    # The server inherits the write end of a pipe, so a pipeline would never
    # see EOF, and -Wait would block on the whole process tree including the
    # long-lived server. Give pg_ctl its own files and let pg_isready below
    # decide when the database is up.
    Start-Process -FilePath (Join-Path $pgBin "pg_ctl.exe") `
        -ArgumentList @("-D", $pgData, "-l", $pgLog, "start") `
        -NoNewWindow `
        -RedirectStandardOutput (Join-Path $workRoot "pgctl.out") `
        -RedirectStandardError (Join-Path $workRoot "pgctl.err") | Out-Null
    Say "pg_ctl launched."
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        & (Join-Path $pgBin "pg_isready.exe") -h localhost -p $port -q 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { Say "pg_ctl start FAILED"; exit 1 }
    Say "PostgreSQL is up."

    Say "createdb..."
    & (Join-Path $pgBin "createdb.exe") -h localhost -p $port -U mirrai mirrai *>&1 | Out-File -FilePath $log -Append
    if ($LASTEXITCODE -ne 0) { Say "createdb FAILED"; exit 1 }

    $env:DATABASE_URL = "postgresql://mirrai@localhost:$port/mirrai"
    $env:NODE_ENV = "production"
    $env:PORT = 3111
    $env:JWT_SECRET = "smoke-test-secret-not-for-production-use-0123456789"
    $env:UPLOAD_DIR = $uploads

    $appDir = Join-Path $dist "app"

    # Same order as the shipped start script: the hand-written WeChat
    # migration first, then drizzle-kit push to create or align the schema.
    Say "applying the WeChat migration..."
    $migration = Join-Path $appDir "drizzle\0002_wechat_clawbot_channel.sql"
    if (Test-Path $migration) {
        & (Join-Path $pgBin "psql.exe") -h localhost -p $port -U mirrai -d mirrai `
            --single-transaction -v ON_ERROR_STOP=1 -f $migration *>&1 | Out-File -FilePath $log -Append
    }

    Say "pushing the schema..."
    Push-Location $appDir
    try {
        # stdin is closed off: drizzle-kit would otherwise sit on a prompt.
        & cmd.exe /c "`"$nodeBin`" `".\node_modules\drizzle-kit\bin.cjs`" push --force < NUL" *>&1 |
            Out-File -FilePath $log -Append
        if ($LASTEXITCODE -ne 0) { Say "drizzle-kit push FAILED"; exit 1 }
    } finally {
        Pop-Location
    }
    Say "schema synchronised."

    Say "checking the tables..."
    $tables = & (Join-Path $pgBin "psql.exe") -h localhost -p $port -U mirrai -d mirrai `
        -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
    Say "the database has $tables tables in the public schema."
    if ([int]$tables -lt 10) { Say "expected at least 10 tables"; exit 1 }

    Say "starting the server..."
    Push-Location $appDir
    $server = Start-Process -FilePath $nodeBin -ArgumentList "dist\index.js" -WorkingDirectory $appDir -PassThru -NoNewWindow
    Pop-Location

    $up = $false
    for ($i = 0; $i -lt 40; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:3111/" -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -lt 500) { $up = $true; break }
        } catch {
            # A 4xx still means the server is listening; only a connection
            # error means it is not up yet.
            $code = $null
            if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
            if ($code -and $code -lt 500) { $up = $true; break }
        }
        Start-Sleep -Seconds 1
    }
    if (-not $up) { Say "the server did not answer on port 3111"; exit 1 }
    Say "the server answered on http://localhost:3111"

    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    & (Join-Path $pgBin "pg_ctl.exe") -D $pgData -m fast stop 2>&1 | Out-File -FilePath $log -Append

    Say "ALL CHECKS PASSED"
    exit 0
} catch {
    Say "EXCEPTION: $($_.Exception.Message)"
    exit 1
}
'@

Set-Content -Path $WorkerScript -Value $worker -Encoding UTF8
Remove-Item $WorkerLog -ErrorAction SilentlyContinue
$cred = New-Object System.Management.Automation.PSCredential($TestUser, $secure)
Log "Running the bundle as '$TestUser'..."
$WorkRoot = Join-Path $PublicDir "work"
New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null
$proc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$WorkerScript`"", "`"$DistDir`"", "`"$WorkerLog`"", "`"$WorkRoot`"") `
    -Credential $cred -LoadUserProfile -PassThru -NoNewWindow

# Stream the worker's log while it runs, so a hang shows up at the step that
# caused it rather than as a silent timeout.
$shown = 0
$deadline = (Get-Date).AddMinutes(6)
$timedOut = $false
while (-not $proc.HasExited) {
    Start-Sleep -Seconds 5
    if (Test-Path $WorkerLog) {
        $lines = @(Get-Content $WorkerLog -ErrorAction SilentlyContinue)
        if ($lines.Count -gt $shown) {
            $lines[$shown..($lines.Count - 1)] | ForEach-Object { Write-Host "  $_" }
            $shown = $lines.Count
        }
    }
    if ((Get-Date) -gt $deadline) {
        $timedOut = $true
        Write-Host "The worker did not finish in time; stopping it."
        try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
        break
    }
}
if (-not $timedOut) { $proc.WaitForExit() }
Write-Host ""

Log "Worker output:"
if (Test-Path $WorkerLog) { Get-Content $WorkerLog | Write-Host } else { Write-Host "  (no log written)" }

Remove-LocalUser -Name $TestUser -ErrorAction SilentlyContinue

if ($timedOut) {
    Die "The smoke test timed out after 6 minutes."
}
if ($proc.ExitCode -ne 0) {
    Die "The smoke test failed (exit code $($proc.ExitCode))."
}
Log "The bundle works: the database initialises, the server starts and answers."
exit 0
