# MandiMate - one command to run the whole stack on Windows (PowerShell 5.1+ or PowerShell 7+).
#
#   .\dev.cmd                  install whatever is missing, then run DB + API + web (Ctrl-C stops API + web)
#   .\dev.cmd -d               same, but in the background (stop later with .\dev.cmd stop)
#   .\dev.cmd share [-d]       same, plus a public HTTPS link (ngrok, or cloudflared)
#   .\dev.cmd install          only install the prerequisites (Docker Desktop, uv, Node.js) with winget
#   .\dev.cmd stop [--all]     stop API + web (--all also stops the database container)
#   .\dev.cmd restart          stop, then start again
#   .\dev.cmd status           what is running, on which ports, AI mode
#   .\dev.cmd logs [api|web|db]
#   .\dev.cmd reset [--hard]   wipe and reload the demo data (--hard also deletes the database volume)
#   .\dev.cmd doctor           check prerequisites and ports without changing anything
#   .\dev.cmd help
#
# (.\dev.ps1 works the same when your execution policy allows scripts; ./dev.sh in Git Bash forwards here.)
#
# Start options (same as dev.sh):
#   -d, --detach        run in the background
#   --open              open the web app in the browser once it is ready
#   --reset             wipe and reload the demo data before starting
#   --seed=auto|always|never
#   --no-install        skip the dependency check (uv sync / npm install)
#   --no-kill           never stop other programs; move MandiMate to free ports instead
#   --force             also stop other database servers that hold the database port
#   --mock-ai / --live-ai
#   --api-port=N --web-port=N --db-port=N
#   -y, --yes           do not ask before installing tools or deleting data
#   --dev               (share) share the hot-reloading dev server instead of the production build
#   --tunnel=auto|ngrok|cloudflared
#
# Missing tools are installed with winget (asks first): Docker Desktop (and WSL 2, which it needs),
# uv (it then installs Python 3.12 by itself), Node.js LTS, and ngrok/cloudflared for `share`.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($PSVersionTable.PSVersion.Major -ge 6 -and -not $IsWindows) {
    Write-Host 'dev.ps1 is for Windows. On macOS and Linux run ./dev.sh instead.'
    exit 1
}

$RootDir = $PSScriptRoot
$BackendDir = Join-Path $RootDir 'backend'
$FrontendDir = Join-Path $RootDir 'frontend'
$StateDir = Join-Path $RootDir '.dev'
$LogDir = Join-Path $StateDir 'logs'
$PidFile = Join-Path $StateDir 'pids'
$PortsFile = Join-Path $StateDir 'ports'
$LockFile = Join-Path $StateDir 'lock'
$DbContainer = 'mandimate-db'
$DbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'mandimate' }
$DbPassword = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { 'mandimate' }
$DbName = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'mandimate' }
$DemoPassword = 'MandiMate@2026'
$DockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$DockerBin = 'C:\Program Files\Docker\Docker\resources\bin'

# ---- Options --------------------------------------------------------------------------------
$Command = 'start'; $Detach = $false; $OpenBrowser = $false; $SeedMode = 'auto'; $Install = $true
$NoKill = $false; $Force = $false; $AssumeYes = $false; $StopAll = $false; $HardReset = $false
$AiOverride = ''; $LogTarget = ''; $ShareDev = $false; $Tunnel = 'auto'; $Share = $false
$ApiPort = if ($env:API_PORT) { [int]$env:API_PORT } else { 8000 }
$WebPort = if ($env:WEB_PORT) { [int]$env:WEB_PORT } else { 5173 }
$DbPort = if ($env:DB_PORT) { [int]$env:DB_PORT } elseif ($env:MANDIMATE_DB_PORT) { [int]$env:MANDIMATE_DB_PORT } else { 5432 }
$ReadyTimeout = if ($env:READY_TIMEOUT) { [int]$env:READY_TIMEOUT } else { 120 }

function Show-Usage {
    foreach ($line in (Get-Content -LiteralPath $PSCommandPath | Select-Object -Skip 1)) {
        if ($line -notmatch '^#') { break }
        $line -replace '^# ?', ''
    }
}

$commandSet = $false
foreach ($a in $args) {
    $s = [string]$a
    switch -Regex ($s) {
        '^(start|stop|restart|status|logs|reset|doctor|help|share|install)$' {
            if ($commandSet -and $Command -eq 'logs') { $LogTarget = $s } else { $Command = $s; $commandSet = $true }; break
        }
        '^(api|web|db)$' { $LogTarget = $s; break }
        '^(-d|--detach)$' { $Detach = $true; break }
        '^--open$' { $OpenBrowser = $true; break }
        '^--reset$' { $SeedMode = 'always'; break }
        '^--seed=' { $SeedMode = $s.Substring(7); break }
        '^--no-seed$' { $SeedMode = 'never'; break }
        '^--no-install$' { $Install = $false; break }
        '^--no-kill$' { $NoKill = $true; break }
        '^--force$' { $Force = $true; break }
        '^--all$' { $StopAll = $true; break }
        '^--hard$' { $HardReset = $true; break }
        '^--mock-ai$' { $AiOverride = 'mock'; break }
        '^--live-ai$' { $AiOverride = 'live'; break }
        '^--api-port=\d+$' { $ApiPort = [int]$s.Split('=')[1]; break }
        '^--web-port=\d+$' { $WebPort = [int]$s.Split('=')[1]; break }
        '^--db-port=\d+$' { $DbPort = [int]$s.Split('=')[1]; break }
        '^(-y|--yes)$' { $AssumeYes = $true; break }
        '^--dev$' { $ShareDev = $true; break }
        '^--tunnel=' { $Tunnel = $s.Substring(9); break }
        '^(-h|--help|/\?)$' { $Command = 'help'; break }
        default { Write-Host "Unknown argument: $s`n"; Show-Usage; exit 2 }
    }
}

# ---- Output ---------------------------------------------------------------------------------
function Tag { Write-Host '[dev] ' -ForegroundColor DarkYellow -NoNewline }
function Say([string]$m) { Tag; Write-Host $m }
function Ok([string]$m) { Tag; Write-Host 'OK ' -ForegroundColor Green -NoNewline; Write-Host $m }
function Warn([string]$m) { Tag; Write-Host "! $m" -ForegroundColor Yellow }
function Fail([string]$m) { Tag; Write-Host "X $m" -ForegroundColor Red; exit 1 }
function Step([string]$m) { Write-Host ''; Write-Host "-- $m" -ForegroundColor DarkYellow }
function Confirm-Action([string]$q) {
    if ($AssumeYes) { return $true }
    $answer = Read-Host "$q [Y/n]"
    return ($answer -eq '' -or $answer -match '^(y|yes)$')
}

# ---- Helpers --------------------------------------------------------------------------------
function Have([string]$name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $extra = @("$env:USERPROFILE\.local\bin", "$env:LOCALAPPDATA\Microsoft\WinGet\Links", $DockerBin, "$env:ProgramFiles\nodejs")
    $env:Path = (@($machine, $user) + $extra | Where-Object { $_ }) -join ';'
}

# Runs a native command without PowerShell 5.1 turning its stderr into terminating errors.
# Returns the combined output as text; the exit code is left in $script:NativeExit.
function Invoke-Native([scriptblock]$Block) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $Block 2>&1 | ForEach-Object { "$_" }
        $script:NativeExit = $LASTEXITCODE
        return ($out -join "`n")
    } finally { $ErrorActionPreference = $prev }
}

# Runs a command line through cmd.exe in a directory, output to a log file (or captured). Returns the exit code.
function Invoke-Cmd([string]$Dir, [string]$CommandLine, [string]$Log = '') {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    Push-Location -LiteralPath $Dir
    try {
        if ($Log) { & cmd.exe /d /s /c "`"$CommandLine > `"$Log`" 2>&1`"" }
        else { $script:CmdOutput = (& cmd.exe /d /s /c "`"$CommandLine 2>&1`"") -join "`n" }
        return $LASTEXITCODE
    } finally { Pop-Location; $ErrorActionPreference = $prev }
}

function Write-TextFile([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding $false))   # no BOM: .env readers choke on it
}

function Get-Tail([string]$Path, [int]$Lines = 25) {
    if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Tail $Lines | ForEach-Object { "      $_" } }
}

function Test-Http([string]$Url, [hashtable]$Headers = @{}) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -Headers $Headers
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)
    } catch { return $false }
}

function Get-AiMode {
    try { return (Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/health" -TimeoutSec 2).ai_mode } catch { return '' }
}

# ---- Prerequisites (installed with winget) --------------------------------------------------
function Install-Tool([string]$Id, [string]$Label) {
    if (-not (Have 'winget')) {
        Fail "$Label is missing and winget is not available. Install 'App Installer' from the Microsoft Store (it provides winget), or install $Label yourself, then run .\dev.cmd again."
    }
    if (-not (Confirm-Action "$Label is not installed. Install it now with winget?")) { Fail "$Label is required." }
    Say "Installing $Label (winget install $Id)..."
    $out = Invoke-Native { winget install -e --id $Id --accept-source-agreements --accept-package-agreements --silent --disable-interactivity }
    # 0 = installed, -1978335189 / -1978335135 = already installed / no newer version
    if ($script:NativeExit -ne 0 -and $script:NativeExit -ne -1978335189 -and $script:NativeExit -ne -1978335135) {
        Write-Host ($out -split "`n" | Select-Object -Last 15 | ForEach-Object { "      $_" } | Out-String)
        Fail "Installing $Label failed (winget exit $($script:NativeExit))."
    }
    Update-SessionPath
    Ok "$Label installed"
}

function Test-NodeVersion {
    if (-not (Have 'node')) { return $false }
    $v = (Invoke-Native { node -v }).Trim().TrimStart('v')
    $parts = $v.Split('.')
    if ($parts.Count -lt 2) { return $false }
    $major = [int]$parts[0]; $minor = [int]$parts[1]
    # Vite 8 needs ^20.19.0 || >=22.12.0
    return (($major -eq 20 -and $minor -ge 19) -or ($major -eq 22 -and $minor -ge 12) -or $major -ge 23)
}

function Test-DockerRunning { $null = Invoke-Native { docker info }; return ($script:NativeExit -eq 0) }

function Test-Compose {
    $v = (Invoke-Native { docker compose version --short }).Trim().TrimStart('v')
    if ($script:NativeExit -ne 0 -or -not $v) { return $false }
    $p = $v.Split('.')
    return ([int]$p[0] -gt 2 -or ([int]$p[0] -eq 2 -and [int]$p[1] -ge 24))
}

function Invoke-Compose([string[]]$ComposeArgs) {
    $all = @('compose', '--project-directory', $RootDir, '-f', (Join-Path $RootDir 'docker-compose.yml')) + $ComposeArgs
    return (Invoke-Native { docker @all })
}

function Test-Wsl {
    $null = Invoke-Native { wsl.exe --status }
    return ($script:NativeExit -eq 0)
}

function Initialize-Docker {
    Update-SessionPath
    if (-not (Have 'docker')) {
        if (-not (Test-Wsl)) {
            Warn 'Docker Desktop needs WSL 2, which is not set up on this PC.'
            if (Confirm-Action 'Install WSL 2 now? (asks for administrator permission; a restart is usually needed)') {
                Start-Process -FilePath 'wsl.exe' -ArgumentList '--install', '--no-distribution' -Verb RunAs -Wait
                Warn 'WSL 2 is installing. Restart Windows when it finishes, then run .\dev.cmd again.'
            }
        }
        Install-Tool 'Docker.DockerDesktop' 'Docker Desktop'
        if (-not (Have 'docker')) {
            Fail 'Docker Desktop is installed. Sign out and back in (or restart Windows) so its tools are on PATH, then run .\dev.cmd again.'
        }
    }
    if (-not (Test-DockerRunning)) {
        if (-not (Test-Path -LiteralPath $DockerExe)) { Fail 'Docker is installed but not running. Start Docker Desktop, then run .\dev.cmd again.' }
        Say 'Docker Desktop is not running - starting it (accept its terms window if one appears)...'
        Start-Process -FilePath $DockerExe | Out-Null
        $waited = 0
        while (-not (Test-DockerRunning)) {
            if ($waited -ge 300) { Fail 'Docker Desktop did not become ready within 5 minutes. Open it, finish any setup it asks for, then run .\dev.cmd again.' }
            Start-Sleep -Seconds 3; $waited += 3
        }
        Ok 'Docker Desktop is ready'
    }
    if (-not (Test-Compose)) { Fail 'Docker Compose v2.24+ is required. Update Docker Desktop (winget upgrade Docker.DockerDesktop).' }
}

function Invoke-Preflight {
    Step 'Checking prerequisites'
    Update-SessionPath
    if (-not (Have 'uv')) { Install-Tool 'astral-sh.uv' 'uv (Python package manager)' }
    if (-not (Have 'uv')) { Fail 'uv was installed but is not on PATH yet. Open a new terminal and run .\dev.cmd again.' }
    if (-not (Test-NodeVersion)) {
        if (Have 'node') { Warn "Node $((Invoke-Native { node -v }).Trim()) is too old for Vite 8 (needs 20.19+ or 22.12+)." }
        Install-Tool 'OpenJS.NodeJS.LTS' 'Node.js LTS'
        if (-not (Test-NodeVersion)) { Fail 'Node.js 20.19+ or 22.12+ is required. Open a new terminal and run .\dev.cmd again.' }
    }
    Initialize-Docker
    Ok ("uv $(((Invoke-Native { uv --version }) -split ' ')[1]) - node $((Invoke-Native { node -v }).Trim()) - $(((Invoke-Native { docker --version }) -split ',')[0])")
}

# ---- Ports ----------------------------------------------------------------------------------
function Get-ListenPids([int]$Port) {
    $ids = @()
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        $ids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    } else {
        foreach ($line in (& netstat.exe -ano -p tcp)) {
            if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)") { $ids += [int]$Matches[1] }
        }
        $ids = @($ids | Select-Object -Unique)
    }
    return @($ids | Where-Object { $_ -gt 4 })
}

function Test-PortOpen([int]$Port) {
    foreach ($h in @('127.0.0.1', '::1')) {
        $c = New-Object Net.Sockets.TcpClient
        try {
            $iar = $c.BeginConnect($h, $Port, $null, $null)
            if ($iar.AsyncWaitHandle.WaitOne(250) -and $c.Connected) { return $true }
        } catch { } finally { $c.Close() }
    }
    return $false
}

function Test-PortBusy([int]$Port) { return ((Get-ListenPids $Port).Count -gt 0 -or (Test-PortOpen $Port)) }

function Wait-PortFree([int]$Port, [int]$Seconds) {
    for ($i = 0; $i -lt $Seconds * 4; $i++) { if (-not (Test-PortBusy $Port)) { return $true }; Start-Sleep -Milliseconds 250 }
    return -not (Test-PortBusy $Port)
}

function Get-ProcInfo([int]$Id) {
    try { return Get-CimInstance Win32_Process -Filter "ProcessId=$Id" -ErrorAction Stop } catch { return $null }
}

function Test-DockerProcess([string]$Name) { return ($Name -match '(?i)docker|vpnkit|wslrelay|containerd|vmmem|podman|rancher') }
function Test-DatabaseProcess([string]$Name) { return ($Name -match '(?i)^(postgres|pg_ctl|mysqld|mariadbd|mongod|redis-server)') }

# Returns $true when the port is free (or is MandiMate's own database container).
function Clear-Port([int]$Port, [string]$Role) {
    if (-not (Test-PortBusy $Port)) { return $true }

    if (Test-DockerRunning) {
        $ids = (Invoke-Native { docker ps -q --filter "publish=$Port" }) -split "`n" | Where-Object { $_.Trim() }
        foreach ($cid in $ids) {
            $name = (Invoke-Native { docker inspect -f '{{.Name}}' $cid }).Trim().TrimStart('/')
            $image = (Invoke-Native { docker inspect -f '{{.Config.Image}}' $cid }).Trim()
            if ($Role -eq 'db' -and $name -eq $DbContainer) { return $true }
            if ($NoKill) { return $false }
            if ($Role -eq 'db' -and -not $Force -and (Test-DatabaseProcess $image)) {
                Warn "Another database container ('$name', $image) is using port $Port - leaving it running."
                return $false
            }
            Say "Stopping Docker container '$name' ($image) - it was using port $Port"
            $null = Invoke-Native { docker stop $cid }
        }
        if ($ids -and (Wait-PortFree $Port 5)) { return $true }
    }

    $pids = Get-ListenPids $Port
    if ($pids.Count -eq 0) {
        Warn "Port $Port is in use by a process this user cannot see or stop (run the terminal as administrator, or use --no-kill)."
        return $false
    }
    if ($NoKill) { return $false }
    foreach ($id in $pids) {
        if ($id -eq $PID) { continue }
        $info = Get-ProcInfo $id
        $pname = if ($info) { $info.Name } else { "pid $id" }
        if (Test-DockerProcess $pname) {
            Warn "Port $Port is held by Docker ($pname) but no running container publishes it; restarting Docker Desktop clears this."
            return $false
        }
        if ($Role -eq 'db' -and -not $Force -and (Test-DatabaseProcess $pname)) {
            Warn "A local $pname server is listening on $Port - leaving your database alone (use --force to stop it)."
            return $false
        }
        $cmdline = if ($info -and $info.CommandLine) { $info.CommandLine.Substring(0, [Math]::Min(110, $info.CommandLine.Length)) } else { '' }
        Say "Stopping '$pname' (pid $id) - it was using port ${Port}: $cmdline"
        $null = Invoke-Native { taskkill.exe /PID $id /T /F }
        if ($script:NativeExit -ne 0) { Warn "No permission to stop pid $id (try an administrator terminal)." }
    }
    return (Wait-PortFree $Port 8)
}

function Get-NextFreePort([int]$Port) {
    for ($p = $Port + 1; $p -le $Port + 100; $p++) { if (-not (Test-PortBusy $p)) { return $p } }
    return 0
}

function Resolve-Port([int]$Port, [string]$Role, [string]$Label) {
    if ($Port -lt 1 -or $Port -gt 65535) { Fail "Invalid $Label port: '$Port'." }
    if (Clear-Port $Port $Role) { return $Port }
    $alt = Get-NextFreePort $Port
    if ($alt -eq 0) { Fail "No free port found near $Port for the $Label." }
    Warn "Using port $alt for the $Label instead of $Port."
    return $alt
}

# ---- Previous runs --------------------------------------------------------------------------
# A recorded process still belongs to MandiMate when it is alive and started at the recorded time
# (guards against Windows reusing the PID for something else).
function Test-RecordedAlive([int]$Id, [string]$Started) {
    $p = Get-Process -Id $Id -ErrorAction SilentlyContinue
    if (-not $p) { return $false }
    try { return ($p.StartTime.ToUniversalTime().ToString('o') -eq $Started) } catch { return $true }
}

function Stop-Tree([int]$Id) { $null = Invoke-Native { taskkill.exe /PID $Id /T /F } }

function Stop-Previous([switch]$Quiet) {
    $found = $false
    if (Test-Path -LiteralPath $LockFile) {
        $other = (Get-Content -LiteralPath $LockFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($other -and [int]$other -ne $PID -and (Get-Process -Id ([int]$other) -ErrorAction SilentlyContinue)) {
            $o = Get-ProcInfo ([int]$other)
            if ($o -and $o.CommandLine -match '(?i)dev\.ps1') {
                Say "Another dev.cmd is running (pid $other) - stopping it first."
                Stop-Tree ([int]$other); $found = $true
            }
        }
        Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
    }

    if (Test-Path -LiteralPath $PidFile) {
        foreach ($line in Get-Content -LiteralPath $PidFile) {
            $f = $line -split ' '
            if ($f.Count -lt 3) { continue }
            if (Test-RecordedAlive ([int]$f[1]) $f[2]) {
                if (-not $Quiet) { Say "Stopping the previous MandiMate $($f[0]) (pid $($f[1]))" }
                Stop-Tree ([int]$f[1]); $found = $true
            }
        }
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    }

    # MandiMate processes started some other way (make, an IDE, a terminal): their command line points into this folder.
    $root = [Regex]::Escape($RootDir)
    try {
        $procs = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
            $_.CommandLine -and $_.CommandLine -match $root -and
            ($_.CommandLine -match 'uvicorn.*app\.main:app' -or $_.CommandLine -match 'vite[\\/]bin[\\/]vite\.js') -and
            $_.CommandLine -notmatch ' (build|preview)( |$)' -and $_.ProcessId -ne $PID
        }
        foreach ($p in $procs) {
            if (-not $Quiet) { Say "Stopping a MandiMate process started elsewhere (pid $($p.ProcessId))" }
            Stop-Tree $p.ProcessId; $found = $true
        }
    } catch { }
    if ($found) { Start-Sleep -Milliseconds 800 }
}

# ---- Setup ----------------------------------------------------------------------------------
function Initialize-EnvFiles {
    $envFile = Join-Path $BackendDir '.env'
    if (-not (Test-Path -LiteralPath $envFile)) {
        $example = Join-Path $BackendDir '.env.example'
        if (-not (Test-Path -LiteralPath $example)) { Fail 'backend/.env.example is missing.' }
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
        $text = [IO.File]::ReadAllText($example)
        $text = [Regex]::Replace($text, '(?m)^JWT_SECRET=.*$', "JWT_SECRET=$secret")
        $text = [Regex]::Replace($text, '(?m)^AI_MODE=.*$', 'AI_MODE=mock')
        Write-TextFile $envFile $text
        Ok 'Created backend/.env (AI_MODE=mock - the free mode; switch to auto for live DeepSeek)'
    }
    $fenv = Join-Path $FrontendDir '.env'
    $fex = Join-Path $FrontendDir '.env.example'
    if (-not (Test-Path -LiteralPath $fenv) -and (Test-Path -LiteralPath $fex)) {
        Copy-Item -LiteralPath $fex -Destination $fenv
        Ok 'Created frontend/.env'
    }
}

function Test-Newer([string]$A, [string]$B) {
    return ((Test-Path -LiteralPath $A) -and (Get-Item -LiteralPath $A).LastWriteTime -gt (Get-Item -LiteralPath $B).LastWriteTime)
}

function Install-Dependencies {
    if (-not $Install) { Say 'Skipping dependency check (--no-install).'; return }
    Step 'Dependencies'
    $stamp = Join-Path $BackendDir '.venv\.mandimate-synced'
    if (-not (Test-Path (Join-Path $BackendDir '.venv\Scripts\python.exe')) -or -not (Test-Path $stamp) -or
        (Test-Newer (Join-Path $BackendDir 'uv.lock') $stamp) -or (Test-Newer (Join-Path $BackendDir 'pyproject.toml') $stamp)) {
        Say 'Installing backend dependencies (uv sync; downloads Python 3.12 if needed)...'
        if ((Invoke-Cmd $BackendDir 'uv sync --quiet' (Join-Path $LogDir 'uv-sync.log')) -ne 0) {
            Get-Tail (Join-Path $LogDir 'uv-sync.log') 20 | Write-Host
            Fail "uv sync failed. Run 'cd backend; uv sync' to see why."
        }
        Set-Content -LiteralPath $stamp -Value (Get-Date -Format o)
    }
    Ok 'Backend dependencies are up to date'

    $stamp = Join-Path $FrontendDir 'node_modules\.mandimate-installed'
    if (-not (Test-Path (Join-Path $FrontendDir 'node_modules\.bin\vite.cmd')) -or -not (Test-Path $stamp) -or
        (Test-Newer (Join-Path $FrontendDir 'package.json') $stamp) -or (Test-Newer (Join-Path $FrontendDir 'package-lock.json') $stamp)) {
        Say 'Installing frontend dependencies (npm install)...'
        if ((Invoke-Cmd $FrontendDir 'npm install --no-audit --no-fund --loglevel=error' (Join-Path $LogDir 'npm-install.log')) -ne 0) {
            Get-Tail (Join-Path $LogDir 'npm-install.log') 20 | Write-Host
            Fail "npm install failed. Run 'cd frontend; npm install' to see why."
        }
        Set-Content -LiteralPath $stamp -Value (Get-Date -Format o)
    }
    Ok 'Frontend dependencies are up to date'
}

# ---- Database -------------------------------------------------------------------------------
function Get-ContainerState { $s = (Invoke-Native { docker inspect -f '{{.State.Status}}' $DbContainer }).Trim(); if ($script:NativeExit -ne 0) { 'missing' } else { $s } }
function Get-ContainerHealth { $s = (Invoke-Native { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $DbContainer }).Trim(); if ($script:NativeExit -ne 0) { 'missing' } else { $s } }
function Get-ContainerPort {
    $out = (Invoke-Native { docker port $DbContainer 5432/tcp }) -split "`n" | Select-Object -First 1
    if ($script:NativeExit -eq 0 -and $out -match ':(\d+)\s*$') { return [int]$Matches[1] }
    return 0
}
function Invoke-DbSql([string]$Sql, [string]$Db = $DbName) {
    return ((Invoke-Native { docker exec -i $DbContainer psql -v ON_ERROR_STOP=1 -U $DbUser -d $Db -tAc $Sql }) -replace '\s', '')
}

function Start-Database {
    Step 'Database (PostgreSQL in Docker)'
    if ((Get-ContainerState) -ne 'missing') {
        $project = (Invoke-Native { docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' $DbContainer }).Trim()
        if ($project -and $project -ne 'mandimate' -and $project -ne '<no value>') {
            Warn "A container named $DbContainer belongs to compose project '$project' - removing that container (its volumes are kept)."
            $null = Invoke-Native { docker rm -f $DbContainer }
        }
    }
    $current = Get-ContainerPort
    if ((Get-ContainerState) -eq 'running' -and $current -gt 0 -and ($current -eq $script:DbPort -or -not (Clear-Port $script:DbPort 'db'))) {
        $script:DbPort = $current
    } else {
        $script:DbPort = Resolve-Port $script:DbPort 'db' 'database'
    }

    $ok = $false; $out = ''
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $env:MANDIMATE_DB_PORT = "$($script:DbPort)"
        $out = Invoke-Compose @('up', '-d', '--wait', '--wait-timeout', '90', 'db')
        if ($script:NativeExit -eq 0) { $ok = $true; break }
        if ($out -match '(?i)port is already allocated|address already in use|bind') {
            Warn "Port $($script:DbPort) was taken while starting the database - trying another port."
            $script:DbPort = Get-NextFreePort $script:DbPort
            if ($script:DbPort -eq 0) { break }
            continue
        }
        break
    }
    if (-not $ok) {
        Write-Host (($out -split "`n" | Select-Object -Last 20) -join "`n")
        Warn 'Recent database logs:'
        Write-Host (Invoke-Native { docker logs --tail 30 $DbContainer })
        Fail 'The database did not start. Try: .\dev.cmd reset --hard (deletes local data) or restart Docker Desktop.'
    }
    for ($t = 0; $true; $t++) {
        $null = Invoke-Native { docker exec -i $DbContainer pg_isready -q -U $DbUser -d $DbName }
        if ($script:NativeExit -eq 0) { break }
        if ($t -ge 120) { Fail "PostgreSQL is not accepting connections (container $(Get-ContainerState), health $(Get-ContainerHealth))." }
        Start-Sleep -Milliseconds 500
    }
    Ok "PostgreSQL is ready on localhost:$($script:DbPort)"
    if ((Invoke-DbSql "SELECT 1 FROM pg_database WHERE datname='mandimate_test'" 'postgres') -ne '1') {
        $null = Invoke-Native { docker exec -i $DbContainer createdb -U $DbUser -O $DbUser mandimate_test }
        if ($script:NativeExit -eq 0) { Ok 'Created the test database mandimate_test' } else { Warn 'Could not create mandimate_test (tests only).' }
    }
}

# Points the backend at the database port actually in use, keeping any custom credentials or host.
function Set-DatabaseUrls {
    $envFile = Join-Path $BackendDir '.env'
    $lines = if (Test-Path -LiteralPath $envFile) { Get-Content -LiteralPath $envFile } else { @() }
    $url = ($lines | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -Last 1)
    $testUrl = ($lines | Where-Object { $_ -match '^TEST_DATABASE_URL=' } | Select-Object -Last 1)
    $url = if ($url) { $url.Substring(13) } else { "postgresql+asyncpg://${DbUser}:${DbPassword}@localhost:5432/$DbName" }
    $testUrl = if ($testUrl) { $testUrl.Substring(18) } else { "postgresql+asyncpg://${DbUser}:${DbPassword}@localhost:5432/mandimate_test" }
    $pattern = '@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/'
    $env:DATABASE_URL = [Regex]::Replace($url, $pattern, "@`${1}:$($script:DbPort)/")
    $env:TEST_DATABASE_URL = [Regex]::Replace($testUrl, $pattern, "@`${1}:$($script:DbPort)/")
    if ($env:DATABASE_URL -notmatch "@(localhost|127\.0\.0\.1|\[::1\]):$($script:DbPort)/") {
        Fail "DATABASE_URL in backend/.env does not point at MandiMate's container (localhost:$($script:DbPort)); refusing to migrate or seed it."
    }
}

function Invoke-Migrations {
    Step 'Migrations'
    for ($i = 1; $i -le 5; $i++) {
        if ((Invoke-Cmd $BackendDir 'uv run alembic upgrade head' (Join-Path $LogDir 'migrate.log')) -eq 0) { Ok 'Database schema is up to date'; return }
        Start-Sleep -Seconds 2
    }
    Get-Tail (Join-Path $LogDir 'migrate.log') 25 | Write-Host
    Fail 'Migrations failed (see above).'
}

function Invoke-Seed {
    Step 'Demo data'
    if ($SeedMode -notin @('auto', 'always', 'never')) { Fail "--seed must be auto, always or never (got '$SeedMode')." }
    if ($SeedMode -eq 'never') { Say 'Skipping demo data (--seed=never).'; return }
    $flags = ''
    $users = Invoke-DbSql 'SELECT count(*) FROM users'
    if ($SeedMode -eq 'always') { $flags = ' --reset' }
    elseif ($users -and $users -ne '0') { Ok "Database already has $users users - keeping your data (.\dev.cmd reset reloads the demo)"; return }
    Say "Loading the Madanapalle demo data$(if ($flags) { ' (wiping existing data first)' })..."
    if ((Invoke-Cmd $BackendDir "uv run python -m app.seed$flags" (Join-Path $LogDir 'seed.log')) -ne 0) {
        Get-Tail (Join-Path $LogDir 'seed.log') 25 | Write-Host
        Fail 'Seeding failed (full log: .dev\logs\seed.log).'
    }
    Ok "Demo data loaded (26 accounts, password $DemoPassword)"
}

# ---- Services -------------------------------------------------------------------------------
$script:Services = @{}   # role -> process (cmd.exe wrapper; its tree is the service)

function Start-Service2([string]$Role, [string]$Dir, [string]$CommandLine) {
    $log = Join-Path $LogDir "$Role.log"
    Write-TextFile $log ''
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList "/d /s /c `"$CommandLine >> `"$log`" 2>&1`"" `
        -WorkingDirectory $Dir -WindowStyle Hidden -PassThru
    $script:Services[$Role] = $p
    Add-Content -LiteralPath $PidFile -Value "$Role $($p.Id) $($p.StartTime.ToUniversalTime().ToString('o'))"
    return $p
}

function Test-ServiceAlive([string]$Role) {
    $p = $script:Services[$Role]
    return ($p -and -not $p.HasExited)
}

function Stop-Services {
    foreach ($role in @($script:Services.Keys)) {
        $p = $script:Services[$role]
        if ($p -and -not $p.HasExited) { Stop-Tree $p.Id }
    }
    $script:Services = @{}
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Wait-UntilReady {
    $apiOk = $false; $webOk = $false
    for ($t = 0; $t -lt $ReadyTimeout; $t++) {
        foreach ($role in @('api', 'web')) {
            if (-not (Test-ServiceAlive $role)) {
                Warn "The $role stopped while starting. Last lines of .dev\logs\$role.log:"
                Get-Tail (Join-Path $LogDir "$role.log") 30 | Write-Host
                return $false
            }
        }
        if (-not $apiOk) { $apiOk = Test-Http "http://127.0.0.1:$($script:ApiPort)/health" }
        if (-not $webOk) { $webOk = Test-Http "http://localhost:$($script:WebPort)/" }
        if ($apiOk -and $webOk) { return $true }
        Start-Sleep -Seconds 1
    }
    Warn "Timed out after ${ReadyTimeout}s waiting for the API ($apiOk) and web ($webOk)."
    return $false
}

# ---- Public link (share) --------------------------------------------------------------------
$script:ShareUrl = ''
$script:TunnelError = ''

function Start-Tunnel2([string]$Name, [string]$Pattern, [string]$CommandLine) {
    $p = Start-Service2 $Name $RootDir $CommandLine
    $log = Join-Path $LogDir "$Name.log"
    for ($t = 0; $t -lt 60; $t++) {
        $text = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue } else { '' }
        if ($text -and $text -match $Pattern) { $script:ShareUrl = $Matches[1]; return $true }
        if ($p.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    Get-Tail $log 5 | Write-Host
    Stop-Tree $p.Id; $script:Services.Remove($Name)
    return $false
}

function Test-TunnelBlocked {
    try {
        $body = (Invoke-WebRequest -Uri "$($script:ShareUrl)/" -UseBasicParsing -TimeoutSec 15 -Headers @{ 'ngrok-skip-browser-warning' = '1' }).Content
    } catch {
        $body = ''
        if ($_.Exception.Response) {
            try { $body = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch { }
        }
    }
    if ($body -match 'ERR_NGROK_725') { $script:TunnelError = "ngrok's free monthly bandwidth is used up (ERR_NGROK_725)"; return $true }
    if ($body -match '(ERR_NGROK_\d+)') { $script:TunnelError = "ngrok refused the link ($($Matches[1]))"; return $true }
    return $false
}

function Start-Ngrok {
    Step 'Public link (ngrok)'
    if (-not (Start-Tunnel2 'ngrok' 'url=(https://\S+)' "ngrok http $($script:WebPort) --log stdout --log-format logfmt")) {
        $script:TunnelError = 'ngrok did not start (missing authtoken: ngrok config add-authtoken <token>, or another free-plan session is open)'
        return $false
    }
    if (Test-TunnelBlocked) {
        Stop-Tree $script:Services['ngrok'].Id; $script:Services.Remove('ngrok'); $script:ShareUrl = ''
        return $false
    }
    return $true
}

function Start-Cloudflared {
    Step 'Public link (cloudflared)'
    if (-not (Start-Tunnel2 'cloudflared' '(https://[a-z0-9-]+\.trycloudflare\.com)' "cloudflared tunnel --no-autoupdate --url http://localhost:$($script:WebPort)")) {
        $script:TunnelError = 'cloudflared did not report a link (see .dev\logs\cloudflared.log)'
        return $false
    }
    return $true
}

function Start-PublicLink {
    switch ($Tunnel) {
        'ngrok' {
            if (-not (Have 'ngrok')) { Install-Tool 'Ngrok.Ngrok' 'ngrok'; Warn 'Add your ngrok token once: ngrok config add-authtoken <token>' }
            if (-not (Start-Ngrok)) { Warn "$($script:TunnelError). Try .\dev.cmd share --tunnel=cloudflared (free, no bandwidth cap)." }
        }
        'cloudflared' {
            if (-not (Have 'cloudflared')) { Install-Tool 'Cloudflare.cloudflared' 'cloudflared' }
            if (-not (Start-Cloudflared)) { Warn "$($script:TunnelError)." }
        }
        'auto' {
            $done = $false
            if (Have 'ngrok') { $done = Start-Ngrok; if (-not $done -and $script:TunnelError) { Warn "$($script:TunnelError)." } }
            if (-not $done) {
                if (-not (Have 'cloudflared')) { Install-Tool 'Cloudflare.cloudflared' 'cloudflared (free, no account, no bandwidth cap)' }
                if (-not (Start-Cloudflared)) { Warn "$($script:TunnelError)." }
            }
        }
        default { Fail "Unknown --tunnel=$Tunnel (use auto, ngrok or cloudflared)." }
    }
    if ($script:ShareUrl) { Ok 'Public link ready' }
}

function Invoke-ShareBuild {
    Step 'Production build for sharing'
    Say 'Building the web app (visitors download ~1 MB instead of ~16 MB; use --dev to share hot reload instead)...'
    if ((Invoke-Cmd $FrontendDir 'npm run --silent build' (Join-Path $LogDir 'build.log')) -ne 0) {
        Get-Tail (Join-Path $LogDir 'build.log') 30 | Write-Host
        Fail 'The production build failed (full log: .dev\logs\build.log). .\dev.cmd share --dev shares the dev server instead.'
    }
    Ok 'Build ready'
}

# ---- Commands -------------------------------------------------------------------------------
function Show-Banner {
    $mode = Get-AiMode
    Write-Host ''
    Write-Host '  MandiMate is running' -ForegroundColor DarkYellow
    Write-Host ('  {0,-10} http://localhost:{1}' -f 'Web', $script:WebPort) -ForegroundColor White
    Write-Host ('  {0,-10} http://localhost:{1}/api/v1   (docs: /api/v1/docs)' -f 'API', $script:ApiPort)
    Write-Host ('  {0,-10} localhost:{1}  (mandimate / mandimate)' -f 'Database', $script:DbPort)
    if ($script:ShareUrl) { Write-Host ('  {0,-10} {1}   (anyone with this link can open the app)' -f 'Public', $script:ShareUrl) -ForegroundColor Green }
    if ($mode -eq 'live') { Write-Host ('  {0,-10} LIVE DeepSeek - AI calls cost money' -f 'AI') -ForegroundColor Yellow }
    else { Write-Host ('  {0,-10} {1} (free, rule-based; --live-ai or AI_MODE=auto in backend\.env for DeepSeek)' -f 'AI', $(if ($mode) { $mode } else { 'mock' })) }
    Write-Host ('  {0,-10} ravi@mandimate.demo (farmer) - procurement@freshbasket.demo (buyer)' -f 'Sign in')
    Write-Host ('  {0,-10} coordinator@madanapallefpo.demo - dispatch@swiftagri.demo - admin@mandimate.demo' -f '')
    Write-Host ('  {0,-10} {1}' -f 'Password', $DemoPassword)
    Write-Host ('  {0,-10} .dev\logs\  -  .\dev.cmd status  -  .\dev.cmd logs' -f 'Logs')
    Write-Host ('  {0,-10} {1}' -f 'Stop', $(if ($Detach) { '.\dev.cmd stop' } else { 'Ctrl-C' }))
    Write-Host ''
}

# Prints new lines from the service logs with [api] / [web] prefixes (foreground mode).
$script:LogOffsets = @{}
function Write-NewLogLines {
    foreach ($role in @('api', 'web', 'ngrok', 'cloudflared')) {
        $path = Join-Path $LogDir "$role.log"
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $fs = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
        try {
            $start = if ($script:LogOffsets.ContainsKey($role)) { $script:LogOffsets[$role] } else { 0 }
            if ($fs.Length -lt $start) { $start = 0 }
            if ($fs.Length -eq $start) { continue }
            $null = $fs.Seek($start, 'Begin')
            $buf = New-Object byte[] ($fs.Length - $start)
            $read = $fs.Read($buf, 0, $buf.Length)
            $text = [Text.Encoding]::UTF8.GetString($buf, 0, $read)
            $cut = $text.LastIndexOf("`n")
            if ($cut -lt 0) { continue }
            $script:LogOffsets[$role] = $start + [Text.Encoding]::UTF8.GetByteCount($text.Substring(0, $cut + 1))
            $color = switch ($role) { 'api' { 'Cyan' } 'web' { 'Magenta' } default { 'DarkGray' } }
            foreach ($line in $text.Substring(0, $cut).Split("`n")) {
                Write-Host ('{0,-7}' -f "[$role]") -ForegroundColor $color -NoNewline
                Write-Host $line.TrimEnd("`r")
            }
        } finally { $fs.Close() }
    }
}

function Open-AppInBrowser { if ($OpenBrowser) { Start-Process "http://localhost:$($script:WebPort)" | Out-Null } }

function Invoke-Start {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    Write-Host 'MandiMate - local stack (Windows)' -ForegroundColor DarkYellow
    Invoke-Preflight

    Step 'Previous runs and ports'
    Stop-Previous
    Set-Content -LiteralPath $LockFile -Value $PID
    $ready = $false
    try {
        $script:ApiPort = Resolve-Port $script:ApiPort 'api' 'API'
        $script:WebPort = Resolve-Port $script:WebPort 'web' 'web app'
        if ($script:ApiPort -eq $script:WebPort) { Fail 'The API and web ports must differ.' }
        Ok "Ports ready - API :$($script:ApiPort) - web :$($script:WebPort)"

        Initialize-EnvFiles
        Install-Dependencies
        Start-Database
        Set-DatabaseUrls
        Invoke-Migrations
        Invoke-Seed

        Step 'API and web'
        $env:MANDIMATE_API_PORT = "$($script:ApiPort)"
        $env:MANDIMATE_WEB_PORT = "$($script:WebPort)"
        $env:CORS_ORIGINS = "http://localhost:$($script:WebPort),http://127.0.0.1:$($script:WebPort),http://localhost:4173,http://localhost:8080"
        $env:PYTHONUNBUFFERED = '1'
        if ($AiOverride) {
            if ($AiOverride -eq 'live' -and -not $env:DEEPSEEK_API_KEY -and
                -not (Select-String -LiteralPath (Join-Path $BackendDir '.env') -Pattern '^DEEPSEEK_API_KEY=.+' -Quiet)) {
                Fail '--live-ai needs DEEPSEEK_API_KEY (in your environment or backend\.env).'
            }
            $env:AI_MODE = $AiOverride
        } elseif ($env:AI_MODE) {
            Warn "Ignoring AI_MODE=$($env:AI_MODE) from your environment; backend\.env decides (use --live-ai / --mock-ai)."
            Remove-Item Env:AI_MODE
        }

        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        $null = Start-Service2 'api' $BackendDir "uv run uvicorn app.main:app --reload --host 127.0.0.1 --port $($script:ApiPort)"
        if ($Share -and -not $ShareDev) {
            Invoke-ShareBuild
            $null = Start-Service2 'web' $FrontendDir "npm run --silent preview -- --port $($script:WebPort) --strictPort"
        } else {
            $null = Start-Service2 'web' $FrontendDir "npm run --silent dev -- --port $($script:WebPort) --strictPort"
        }
        Write-TextFile $PortsFile "API_PORT=$($script:ApiPort)`nWEB_PORT=$($script:WebPort)`nDB_PORT=$($script:DbPort)`n"

        if (-not (Wait-UntilReady)) { Fail 'MandiMate did not start. Full logs: .dev\logs\api.log and .dev\logs\web.log' }
        if ($Share) { Start-PublicLink }
        $ready = $true
        Show-Banner
        Open-AppInBrowser
        if ($Detach) { return }

        while ($true) {
            Write-NewLogLines
            foreach ($role in @('api', 'web')) {
                if (-not (Test-ServiceAlive $role)) {
                    Write-NewLogLines
                    Fail "The $role stopped unexpectedly (full log: .dev\logs\$role.log)."
                }
            }
            foreach ($t in @('ngrok', 'cloudflared')) {
                if ($script:Services.ContainsKey($t) -and $script:Services[$t].HasExited) {
                    Warn 'The public tunnel closed (see .dev\logs\); the app keeps running locally.'
                    $script:Services.Remove($t)
                }
            }
            Start-Sleep -Milliseconds 500
        }
    } finally {
        if ((-not $Detach -or -not $ready) -and $script:Services.Count -gt 0) {
            Write-Host ''
            Say 'Stopping API and web...'
            Stop-Services
            Ok 'Stopped. The database keeps running (.\dev.cmd stop --all stops it too).'
        }
        if ((Test-Path -LiteralPath $LockFile) -and (Get-Content -LiteralPath $LockFile -ErrorAction SilentlyContinue) -eq "$PID") {
            Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
        }
    }
}

function Read-Ports {
    if (Test-Path -LiteralPath $PortsFile) {
        foreach ($line in Get-Content -LiteralPath $PortsFile) {
            if ($line -match '^API_PORT=(\d+)') { $script:ApiPort = [int]$Matches[1] }
            if ($line -match '^WEB_PORT=(\d+)') { $script:WebPort = [int]$Matches[1] }
            if ($line -match '^DB_PORT=(\d+)') { $script:DbPort = [int]$Matches[1] }
        }
    }
}

function Invoke-Stop {
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    Stop-Previous
    Ok 'API and web are stopped'
    if ($StopAll) {
        Update-SessionPath
        if ((Have 'docker') -and (Test-DockerRunning)) { $null = Invoke-Compose @('stop', 'db'); Ok 'Database container stopped (data is kept)' }
    } else {
        Say 'The database keeps running (.\dev.cmd stop --all stops it too).'
    }
}

function Invoke-Status {
    Read-Ports
    Update-SessionPath
    Write-Host 'MandiMate status' -ForegroundColor DarkYellow
    if ((Have 'docker') -and (Test-DockerRunning)) {
        Write-Host ('  {0,-9} {1} (health: {2}, port {3})' -f 'Database', (Get-ContainerState), (Get-ContainerHealth), (Get-ContainerPort))
    } else { Write-Host ('  {0,-9} Docker is not running' -f 'Database') }
    if (Test-Http "http://127.0.0.1:$($script:ApiPort)/health") { Write-Host ('  {0,-9} running on :{1} (AI {2})' -f 'API', $script:ApiPort, (Get-AiMode)) -ForegroundColor Green }
    else { Write-Host ('  {0,-9} stopped (port {1})' -f 'API', $script:ApiPort) -ForegroundColor DarkGray }
    if (Test-Http "http://localhost:$($script:WebPort)/") { Write-Host ('  {0,-9} running on http://localhost:{1}' -f 'Web', $script:WebPort) -ForegroundColor Green }
    else { Write-Host ('  {0,-9} stopped (port {1})' -f 'Web', $script:WebPort) -ForegroundColor DarkGray }
    foreach ($port in @($script:ApiPort, $script:WebPort, $script:DbPort)) {
        foreach ($id in (Get-ListenPids $port)) {
            $info = Get-ProcInfo $id
            Write-Host ('  {0,-9} :{1} <- {2} (pid {3})' -f 'Port', $port, $(if ($info) { $info.Name } else { '?' }), $id)
        }
    }
}

function Invoke-Logs {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $api = Join-Path $LogDir 'api.log'; $web = Join-Path $LogDir 'web.log'
    switch ($LogTarget) {
        'api' { Get-Content -LiteralPath $api -Tail 100 -Wait }
        'web' { Get-Content -LiteralPath $web -Tail 100 -Wait }
        'db' { Update-SessionPath; docker logs -f --tail 100 $DbContainer }
        default {
            foreach ($r in @('api', 'web')) { $script:LogOffsets[$r] = [Math]::Max(0, (Get-Item -LiteralPath (Join-Path $LogDir "$r.log") -ErrorAction SilentlyContinue).Length - 4000) }
            while ($true) { Write-NewLogLines; Start-Sleep -Milliseconds 500 }
        }
    }
}

function Invoke-Doctor {
    Update-SessionPath
    Step 'Prerequisites'
    foreach ($t in @('winget', 'uv', 'node', 'npm', 'docker', 'wsl')) { if (Have $t) { Ok "$t found" } else { Warn "$t missing$(if ($t -ne 'wsl') { ' (.\dev.cmd install adds it)' })" } }
    if (Have 'node') { if (Test-NodeVersion) { Ok "node $((Invoke-Native { node -v }).Trim())" } else { Warn 'node is too old (need 20.19+ or 22.12+)' } }
    if ((Have 'docker') -and (Test-DockerRunning)) {
        Ok 'Docker is running'
        if (Test-Compose) { Ok 'Docker Compose v2.24+ found' } else { Warn 'Docker Compose v2.24+ missing' }
    } else { Warn 'Docker is not running (.\dev.cmd starts Docker Desktop)' }
    Step 'Ports'
    foreach ($pair in @(@($script:ApiPort, 'API'), @($script:WebPort, 'web'), @($script:DbPort, 'database'))) {
        if (Test-PortBusy $pair[0]) {
            $who = (Get-ListenPids $pair[0] | ForEach-Object { $i = Get-ProcInfo $_; "$(if ($i) { $i.Name } else { '?' })($_)" }) -join ' '
            Say "Port $($pair[0]) ($($pair[1])) is in use: $(if ($who) { $who } else { 'a process this user cannot see' })"
        } else { Ok "Port $($pair[0]) ($($pair[1])) is free" }
    }
    Step 'Files'
    if (Test-Path (Join-Path $BackendDir '.env')) { Ok 'backend\.env exists' } else { Say 'backend\.env will be created from the example' }
    if (Test-Path (Join-Path $FrontendDir 'node_modules\.bin\vite.cmd')) { Ok 'frontend dependencies installed' } else { Say 'frontend dependencies will be installed' }
    if (Test-Path (Join-Path $BackendDir '.venv\Scripts\python.exe')) { Ok 'backend virtualenv exists' } else { Say 'backend dependencies will be installed' }
}

function Invoke-Reset {
    if ($HardReset) {
        if (-not $AssumeYes) {
            $answer = Read-Host 'This deletes the local MandiMate database volume and uploaded media. Continue? [y/N]'
            if ($answer -notmatch '^(y|yes)$') { Say 'Cancelled.'; exit 0 }
        }
        Initialize-Docker
        Stop-Previous -Quiet
        $null = Invoke-Compose @('down', '-v', '--remove-orphans')
        Ok 'Removed the database volume; it will be recreated empty and reseeded.'
    }
    $script:SeedMode = 'always'
    Invoke-Start
}

switch ($Command) {
    'help' { Show-Usage }
    'install' { Invoke-Preflight; Ok 'All prerequisites are installed. Run .\dev.cmd to start MandiMate.' }
    'start' { Invoke-Start }
    'share' { $Share = $true; Invoke-Start }
    'stop' { Invoke-Stop }
    'restart' { Stop-Previous; Invoke-Start }
    'status' { Invoke-Status }
    'logs' { Invoke-Logs }
    'reset' { Invoke-Reset }
    'doctor' { Invoke-Doctor }
}
