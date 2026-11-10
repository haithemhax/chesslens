param(
    [switch]$DownloadWheels,
    [switch]$OfflineOnly
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$visionDir = Join-Path $projectDir "vision-service"
$venvDir = Join-Path $visionDir ".venv"
$wheelsDir = Join-Path $visionDir "wheels"
$reqFile = Join-Path $visionDir "requirements.txt"

Write-Host "=== ChessLens Python Vision Service Setup ===" -ForegroundColor Cyan

# 1. Locate Python 3.11 (fallback to Python 3.14)
$python311Default = "C:\Users\haithem\AppData\Local\Programs\Python\Python311\python.exe"
$pythonExe = $null

if (Test-Path $python311Default) {
    $pythonExe = $python311Default
    Write-Host "Found Python 3.11: $pythonExe" -ForegroundColor Green
} else {
    try {
        $pyPath = (py -3.11 -c "import sys; print(sys.executable)" 2>$null)
        if ($pyPath -and (Test-Path $pyPath)) {
            $pythonExe = $pyPath.Trim()
            Write-Host "Found Python 3.11 via py launcher: $pythonExe" -ForegroundColor Green
        }
    } catch {}
}

if (!$pythonExe) {
    Write-Host "Python 3.11 not found; checking default Python..." -ForegroundColor Yellow
    try {
        $pyPath = (python -c "import sys; print(sys.executable)" 2>$null)
        if ($pyPath -and (Test-Path $pyPath)) {
            $pythonExe = $pyPath.Trim()
            Write-Host "Found Python fallback: $pythonExe" -ForegroundColor Yellow
        }
    } catch {}
}

if (!$pythonExe) {
    Write-Error "ERROR: No suitable Python executable found. Please install Python 3.11 from python.org."
    exit 1
}

# 2. Create or verify virtual environment
$venvPython = Join-Path $venvDir "Scripts\python.exe"
if (!(Test-Path $venvPython)) {
    Write-Host "Creating virtual environment at $venvDir..." -ForegroundColor Cyan
    & $pythonExe -m venv $venvDir
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create virtual environment."
        exit 1
    }
}
Write-Host "Virtual environment ready: $venvPython" -ForegroundColor Green

# 3. Optional: download wheels for offline distribution
if ($DownloadWheels) {
    Write-Host "Downloading offline wheels to $wheelsDir..." -ForegroundColor Cyan
    if (!(Test-Path $wheelsDir)) { New-Item -ItemType Directory -Path $wheelsDir | Out-Null }
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip download -d $wheelsDir -r $reqFile
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to download wheels."
        exit 1
    }
    Write-Host "Wheels downloaded successfully to $wheelsDir." -ForegroundColor Green
}

# 4. Install dependencies
$hasWheels = (Test-Path $wheelsDir) -and (Get-ChildItem $wheelsDir -Filter "*.whl" -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0

if ($hasWheels) {
    Write-Host "Installing dependencies OFFLINE from $wheelsDir..." -ForegroundColor Cyan
    & $venvPython -m pip install --no-index --find-links=$wheelsDir -r $reqFile
} elseif ($OfflineOnly) {
    Write-Error "ERROR: OfflineOnly requested but no wheel files found in $wheelsDir."
    exit 1
} else {
    Write-Host "Installing dependencies from PyPI (online)..." -ForegroundColor Cyan
    & $venvPython -m pip install -r $reqFile
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Dependency installation failed."
    exit 1
}

# 5. Verification: verify all critical imports and fail loudly if missing
Write-Host "Verifying critical imports (cv2, numpy, websockets, chess)..." -ForegroundColor Cyan
$verifyScript = @"
import sys
missing = []
for pkg in ['cv2', 'numpy', 'websockets', 'chess']:
    try:
        __import__(pkg)
    except ImportError as e:
        missing.append((pkg, str(e)))

if missing:
    print('FAILED_IMPORTS:', missing)
    sys.exit(1)
else:
    print('ALL_IMPORTS_VERIFIED_SUCCESSFULLY')
    sys.exit(0)
"@

& $venvPython -c $verifyScript

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Red
    Write-Host "CRITICAL ERROR: Failed to import required vision modules!" -ForegroundColor Red
    Write-Host "The vision service will NOT run without cv2, numpy, websockets, and chess." -ForegroundColor Red
    Write-Host "Please check requirements.txt and wheels/ directory." -ForegroundColor Red
    Write-Host "==========================================================" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host ">>> SUCCESS: ChessLens Python Vision Service is completely configured and verified! <<<" -ForegroundColor Green
