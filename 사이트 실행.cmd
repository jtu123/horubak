@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0frontend"
set "MOMENT_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "MOMENT_PNPM=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.mjs"
if exist "%MOMENT_NODE%" goto runtime_ready
set "MOMENT_NODE=node"
where node.exe >nul 2>nul
if errorlevel 1 goto missing_runtime
:runtime_ready
if exist "node_modules\vite\bin\vite.js" goto start_site
if not exist "%MOMENT_PNPM%" goto missing_packages
echo 사이트에 필요한 패키지를 설치합니다...
"%MOMENT_NODE%" "%MOMENT_PNPM%" install --store-dir "%~dp0.cache\pnpm-store"
if errorlevel 1 goto failed
:start_site
echo.
echo 호루박 사이트: http://127.0.0.1:5173/
echo 브라우저에서 주소를 열고 '샘플로 시작'를 누르세요.
echo 종료하려면 이 창에서 Ctrl+C를 누르세요.
echo.
"%MOMENT_NODE%" node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173 --strictPort
goto done
:missing_runtime
echo Node.js를 찾지 못했습니다. README.md의 실행 안내를 확인해 주세요.
goto done
:missing_packages
echo frontend 폴더에서 pnpm install 명령을 먼저 실행해 주세요.
goto done
:failed
echo 패키지 설치에 실패했습니다. 위 오류 내용을 확인해 주세요.
:done
pause
