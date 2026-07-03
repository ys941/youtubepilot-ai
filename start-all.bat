@echo off
title YouTubePilot AI - Launcher
color 0A

echo.
echo  ================================================================
echo    YOUTUBEPILOT AI  ^|  Starting All Services
echo    Autonomous, white-label AI YouTube Shorts engine
echo  ================================================================
echo.

:: ── Step 1: Check Docker ─────────────────────────────────────────────────────
echo  [1/4] Checking Docker Desktop...
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

:: ── Step 2: Start PostgreSQL ─────────────────────────────────────────────────
echo  [2/4] Starting PostgreSQL...
docker compose up -d postgres >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Failed to start Postgres. Check docker-compose.yml.
    pause
    exit /b 1
)
echo  [OK] PostgreSQL container started.
echo.

echo        Waiting for PostgreSQL to be ready...
:wait_db
docker exec youtubepilot-postgres pg_isready -U youtubepilot -d youtubepilot_db >nul 2>&1
if %errorlevel% neq 0 (
    echo         ... still waiting for database...
    timeout /t 3 /nobreak >nul
    goto wait_db
)
echo  [OK] PostgreSQL is ready.
echo.

:: ── Step 3: Prisma client + schema ───────────────────────────────────────────
echo  [3/4] Preparing database...
call npx prisma generate
:: Schema sync is a deliberate step, not silently forced: no --accept-data-loss
:: (never auto-drop columns) and output is surfaced so failures are visible.
call npx prisma db push
echo  [OK] Prisma client generated and schema synced.
echo.

:: ── Step 4: Start Next.js dev server ─────────────────────────────────────────
echo  [4/4] Starting YouTubePilot AI dashboard...
start "YouTubePilot - Dashboard" cmd /k "color 0D && title YouTubePilot AI Dev Server && echo. && echo  YouTubePilot AI is starting... && echo  Open: http://localhost:3000 && echo. && npm run dev"
echo  [OK] Next.js dev server starting...
echo.

echo  Waiting 12 seconds for Next.js to compile...
timeout /t 12 /nobreak >nul
start http://localhost:3000
echo.

echo  ================================================================
echo.
echo    YouTubePilot AI is running!
echo.
echo    Dashboard   :  http://localhost:3000
echo    PostgreSQL  :  localhost:5432  (youtubepilot_db)
echo.
echo    Log in with the value of APP_ACCESS_KEY in your .env.local
echo.
echo    To stop:
echo      - Close the dashboard terminal window
echo      - Run: docker compose down
echo.
echo  ================================================================
echo.
pause
