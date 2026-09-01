@echo off
REM ── Falatorio: sobe o servidor nesta maquina (Windows) ──────────────
REM Deixe este arquivo dentro da pasta "server" e clique duas vezes nele.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado.
  echo  Baixe a versao LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando as dependencias pela primeira vez...
  call npm install
  if errorlevel 1 (
    echo.
    echo  A instalacao falhou. Confira sua internet e tente de novo.
    pause
    exit /b 1
  )
)

if not exist .env (
  echo.
  echo  AVISO: nao existe arquivo .env, entao a sala vai ficar SEM SENHA.
  echo  Para pedir senha: copie .env.example para .env e preencha ROOM_PASSWORD.
  echo.
)

echo.
echo  Servidor subindo. Deixe esta janela aberta enquanto voces usam.
echo  Para encerrar, feche a janela ou aperte Ctrl+C.
echo.
node server.js
pause
