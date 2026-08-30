@echo off
title YouTubePilot AI - Launcher
color 0A

echo.
echo  ================================================================
echo    YOUTUBEPILOT AI  ^|  Starting All Services
echo    Autonomous, white-label AI YouTube Shorts engine
echo  ================================================================
echo.

:: Always run from this script's own folder, however it was invoked.
cd /d "%~dp0"

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

:: ── Step 2: Node dependencies ────────────────────────────────────────────────
:: First run on a fresh machine (or after node_modules is deleted) installs
:: everything automatically instead of failing later with "next is not recognized".
echo  [2/5] Checking Node dependencies...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Node.js / npm was not found on PATH.
    echo          Install Node 18+ from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
)
if not exist "node_modules" (
    echo        node_modules missing - installing dependencies.
    echo        This can take several minutes on the first run, please wait...
    if exist "package-lock.json" (
        call npm ci --no-audit --no-fund
    ) else (
        call npm install --no-audit --no-fund
    )
    if errorlevel 1 (
        echo  [ERROR] Dependency install failed. Check the output above.
        pause
        exit /b 1
    )
)
echo  [OK] Dependencies are installed.
echo.

:: ── Step 3: Start PostgreSQL ─────────────────────────────────────────────────
:: Creates the container, user, password and database automatically from
:: docker-compose.yml the first time - nothing to set up by hand.
echo  [3/5] Starting PostgreSQL...

:: A sibling project (e.g. cardioflow/InstaPilot) may already hold port 5432 with
:: a different Postgres. Only one can own the port, so stand the other one down.
for /f "tokens=*" %%C in ('docker ps --filter "publish=5432" --format "{{.Names}}" 2^>nul') do (
    if not "%%C"=="youtubepilot-postgres" (
        echo        Port 5432 is held by "%%C" - stopping it so this project can use it.
        docker stop %%C >nul 2>&1
    )
)

docker compose up -d postgres >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Failed to start Postgres. Check docker-compose.yml.
    pause
    exit /b 1
)
echo  [OK] PostgreSQL container started.
echo.

echo        Waiting for PostgreSQL to be ready...
:: Counter lives on its own lines (not inside a parenthesised block) so plain
:: %VAR% expansion works on each re-entry via goto - no delayed expansion needed,
:: which would otherwise swallow the "!" in this script's echo lines.
set DB_TRIES=0
:wait_db
docker exec youtubepilot-postgres pg_isready -U youtubepilot -d youtubepilot_db >nul 2>&1
if %errorlevel% equ 0 goto db_ready
set /a DB_TRIES+=1
if %DB_TRIES% geq 40 (
    echo  [ERROR] PostgreSQL did not become ready within 2 minutes.
    echo          Check: docker logs youtubepilot-postgres
    pause
    exit /b 1
)
echo         ... still waiting for database...
timeout /t 3 /nobreak >nul
goto wait_db
:db_ready
echo  [OK] PostgreSQL is ready.
echo.

:: ── Step 4: Prisma client + schema ───────────────────────────────────────────
:: NOTE: the Prisma CLI reads .env (NOT .env.local, which Next.js prefers). Both
:: files must carry the same DATABASE_URL or this step silently targets the wrong
:: database and the app starts with no tables.
echo  [4/5] Preparing database...
call npx prisma generate
:: Schema sync is a deliberate step, not silently forced: no --accept-data-loss
:: (never auto-drop columns) and output is surfaced so failures are visible.
call npx prisma db push
if errorlevel 1 (
    echo  [ERROR] Schema sync failed - the app would start with no tables.
    echo          Check that DATABASE_URL in .env matches docker-compose.yml.
    pause
    exit /b 1
)
echo  [OK] Prisma client generated and schema synced.
echo.

:: ── Step 5: Start Next.js dev server ─────────────────────────────────────────
echo  [5/5] Starting YouTubePilot AI dashboard...
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
