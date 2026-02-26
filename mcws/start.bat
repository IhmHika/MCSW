@echo off
title Minecraft Discord Bot
echo Bot Start...
:loop
node index.js
echo.
echo Botが停止しました。10秒後に再起動します（中断は Ctrl+C）。
timeout /t 10
goto loop