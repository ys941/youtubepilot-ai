@echo off
title YouTubePilot AI - Launcher
color 0A

echo.
echo  ================================================================
echo    YOUTUBEPILOT AI  ^|  Starting All Services
echo    Autonomous AI YouTube Shorts content engine
echo  ================================================================
echo.

:: ── Load config from .env (optional) ──────────────────────────────────────────
:: ngrok is optional — use it only if you want to expose your local server to the
:: public internet for testing. Set these in your environment (or a local .env) —
:: NONE are committed/shipped:
::   set NGROK_AUTHTOKEN=<your ngrok authtoken>
::   set NGROK_STATIC_DOMAIN=<your-reserved-domain>.ngrok-free.dev   (optional)
:: Leave them unset to skip the tunnel and just run the app locally.

:: ── Step 1: Check Docker ─────────────────────────────────────────────────────
echo  [1/5] Checking Docker Desktop...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Docker is not running!
    echo          Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)
echo  [OK] Docker is running.
echo.

:: ── Step 2: Start PostgreSQL (+ Redis) ───────────────────────────────────────
echo  [2/5] Starting PostgreSQL + Redis...
docker compose up -d postgres redis >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Failed to start Docker services. Check docker-compose.yml.
    pause
    exit /b 1
)
echo  [OK] PostgreSQL and Redis containers started.
echo.

:: ── Step 3: Wait for PostgreSQL to be ready ──────────────────────────────────
echo  [3/5] Waiting for PostgreSQL to be ready...
:wait_db
docker exec youtubepilot-postgres pg_isready -U youtubepilot -d youtubepilot_db >nul 2>&1
if %errorlevel% neq 0 (
    echo         ... still waiting for database...
    timeout /t 3 /nobreak >nul
    goto wait_db
)
echo  [OK] PostgreSQL is ready.
echo.

:: ── Step 4: Generate Prisma Client + Push Schema ──────────────────────────────
echo  [4/5] Preparing database...
call npx prisma generate >nul 2>&1
call npx prisma db push --accept-data-loss >nul 2>&1
echo  [OK] Prisma client generated and schema synced.
echo.

:: ── Step 5: Start Next.js Dev Server ─────────────────────────────────────────
echo  [5/5] Starting YouTubePilot AI dashboard...
start "YouTubePilot - Dashboard" cmd /k "color 0D && title YouTubePilot AI Dev Server && echo. && echo  YouTubePilot AI is starting... && echo  Open: http://localhost:3000 && echo. && npm run dev"
echo  [OK] Next.js dev server starting...
echo.

:: ── Optional: ngrok tunnel (generic public access) ───────────────────────────
if "%NGROK_AUTHTOKEN%"=="" (
    echo  [i] NGROK_AUTHTOKEN not set - skipping public tunnel.
    echo      Set NGROK_AUTHTOKEN ^(and optionally NGROK_STATIC_DOMAIN^) to expose
    echo      http://localhost:3000 to the public internet.
) else (
    echo  Starting ngrok tunnel...
    powershell -Command "Stop-Process -Name ngrok -Force -ErrorAction SilentlyContinue" >nul 2>&1
    ngrok config add-authtoken %NGROK_AUTHTOKEN% >nul 2>&1
    if "%NGROK_STATIC_DOMAIN%"=="" (
        start "YouTubePilot - ngrok Tunnel" cmd /k "title YouTubePilot ngrok Tunnel && ngrok http 3000"
    ) else (
        start "YouTubePilot - ngrok Tunnel" cmd /k "title YouTubePilot ngrok Tunnel && echo Public URL: https://%NGROK_STATIC_DOMAIN% && ngrok http --url=%NGROK_STATIC_DOMAIN% 3000"
    )
)
echo.

echo  Waiting 12 seconds for Next.js to compile...
timeout /t 12 /nobreak >nul
echo  Opening YouTubePilot AI in browser...
start http://localhost:3000
echo.

echo  ================================================================
echo.
echo    YouTubePilot AI is running!
echo.
echo    Dashboard   :  http://localhost:3000
echo    PostgreSQL  :  localhost:5432  (youtubepilot_db)
echo    Redis       :  localhost:6379
echo.
echo    To stop:
echo      - Close the terminal windows (dashboard + tunnel)
echo      - Run: docker compose down
echo.
echo  ================================================================
echo.
pause
