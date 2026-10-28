@echo off
chcp 65001 >nul
title 1296Todolist - 一键启动

set PORT=1998
set PROJECT_DIR=%~dp0
cd /d "%PROJECT_DIR%"

echo ============================================
echo        1296Todolist 一键启动脚本
echo ============================================
echo.

netstat -ano 2>nul | findstr /R ":%PORT% " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [!] 端口 %PORT% 被占用，正在释放...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R ":%PORT% " ^| findstr "LISTENING"') do (
        echo     正在终止 PID: %%a ...
        taskkill /PID %%a /F >nul 2>&1
    )
    timeout /t 1 /nobreak >nul
    echo [OK] 端口 %PORT% 已释放
    echo.
) else (
    echo [OK] 端口 %PORT% 空闲可用
    echo.
)

if not exist "node_modules" (
    echo [!] 检测到 node_modules 不存在，正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo [ERROR] 依赖安装失败
        pause
        exit /b 1
    )
    echo.
)

echo [*] 正在启动服务...
echo.
start "" http://localhost:%PORT%/
call npx vite --host