@echo off
chcp 65001 >nul
setlocal
set SERVER=root@213.21.229.145
set APPDIR=/opt/delo-marketplace
set DEST=C:\delo-backup

REM Full paths to ssh.exe and scp.exe - see comment in deploy.bat.
set SSH="%SystemRoot%\System32\OpenSSH\ssh.exe"
set SCP="%SystemRoot%\System32\OpenSSH\scp.exe"
set CERTUTIL=%SystemRoot%\System32\certutil.exe

REM Downloads the latest complete backup (database, uploaded files, .env)
REM into %DEST%\NAME and checks every file against SHA256SUMS.
REM The download goes to %DEST%\_downloading first: a folder named like
REM a backup is always a complete, checked copy.

echo ================================================
echo   DELO - Download latest backup to this computer
echo ================================================
echo.
echo   Server: %SERVER%
echo   Folder: %DEST%
echo.
echo   The server password may be asked twice:
echo   to find the backup, then to download it.
echo.

if not exist %SSH% goto :nossh
if not exist %SCP% goto :nossh
if not exist "%DEST%\" mkdir "%DEST%"
if not exist "%DEST%\" goto :nodest
cd /d "%DEST%"
if errorlevel 1 goto :nodest

echo [1/3] Finding the latest backup on the server...
%SSH% -o ConnectTimeout=15 %SERVER% "bash %APPDIR%/scripts/backup.sh --latest" > "_latest.txt"
set RC=%errorlevel%
set "REMOTE="
if "%RC%"=="0" for /f "usebackq delims=" %%L in ("_latest.txt") do set "REMOTE=%%L"
del "_latest.txt" 2>nul
if "%RC%"=="3" goto :nobackups
if "%RC%"=="255" goto :noserver
if not "%RC%"=="0" goto :oldserver
if not defined REMOTE goto :oldserver
if not "%REMOTE:~0,1%"=="/" goto :oldserver
set "NAME=%REMOTE:/=\%"
for %%I in ("%NAME%") do set "NAME=%%~nxI"
if not defined NAME goto :oldserver
echo   Latest backup: %NAME%  (date_time, server time)
echo.

if exist "%NAME%\OK" (
    echo   Already downloaded: %DEST%\%NAME%
    echo   No newer backup on the server yet.
    echo.
    goto :list
)

echo [2/3] Downloading. Big file archives take a few minutes.
echo ----------------------------------------------------------------
if exist "_downloading\" rmdir /s /q "_downloading"
mkdir "_downloading"
%SCP% -r -o ConnectTimeout=15 %SERVER%:%REMOTE% "_downloading"
if errorlevel 1 goto :fail
echo ----------------------------------------------------------------
echo   OK
echo.

echo [3/3] Checking checksums...
set "GOT=_downloading\%NAME%"
REM Some scp versions put the files straight into _downloading.
if not exist "%GOT%\" if exist "_downloading\SHA256SUMS" set "GOT=_downloading"
if not exist "%GOT%\OK" goto :incomplete
if not exist "%GOT%\SHA256SUMS" goto :incomplete
if not exist "%GOT%\db.dump" goto :incomplete
set BAD=0
set FILES=0
for /f "usebackq tokens=1,*" %%A in ("%GOT%\SHA256SUMS") do call :checkfile %%A "%%B"
if not "%BAD%"=="0" goto :corrupt
if "%FILES%"=="0" goto :incomplete
if exist "%NAME%\" rmdir /s /q "%NAME%"
move "%GOT%" "%NAME%" >nul
if errorlevel 1 goto :nomove
rmdir "_downloading" 2>nul
echo   OK - all %FILES% files match.
echo.
echo   Saved: %DEST%\%NAME%
echo.

:list
echo   Backups on this computer (newest first):
for /f "delims=" %%D in ('dir /b /ad /o-n "%DEST%"') do echo     %%D
echo.
echo   Old backups are not deleted automatically:
echo   keep the last 3-4, delete older folders by hand.
echo.
echo   A backup holds .env (file "env"): passwords, tokens, SECRET_KEY.
echo   Keep this folder private and never send it to anyone.
echo.
pause
exit /b 0

REM Arguments: SHA256 from SHA256SUMS, then the file name. certutil prints
REM the hash on its 2nd line: hex, with spaces on old Windows - removed.
:checkfile
set /a FILES+=1
set "SUM="
for /f "skip=1 delims=" %%H in ('%CERTUTIL% -hashfile "%GOT%\%~2" SHA256') do if not defined SUM set "SUM=%%H"
if not defined SUM set "SUM=none"
set "SUM=%SUM: =%"
if /i "%SUM%"=="%~1" (
    echo   ok    %~2
) else (
    echo   BAD   %~2
    set BAD=1
)
goto :eof

:nossh
echo.
echo   ERROR: Windows OpenSSH client not found: %SSH%
echo   Install it: Settings - Apps - Optional features - OpenSSH Client.
goto :end_error

:noserver
echo.
echo   ERROR: could not connect to the server, see the message above.
echo   Wrong password, no internet, or the server is down.
echo   Check: status-server.bat
goto :end_error

:oldserver
echo.
echo   ERROR: the server did not return a backup name, see the message above.
echo   Most likely the server runs an older version: run deploy.bat first,
echo   then run this file again.
goto :end_error

:nobackups
echo.
echo   ERROR: there are no complete backups on the server yet.
echo   Make the first one and turn on nightly backups:
echo     server-shell.bat
echo     cd %APPDIR% ^&^& bash scripts/backup.sh --install
goto :end_error

:nodest
echo.
echo   ERROR: cannot create or open folder %DEST%
goto :end_error

:nomove
echo.
echo   ERROR: the backup is downloaded and checked, but could not be moved to
echo   %DEST%\%NAME%
echo   It is here: %DEST%\%GOT%  - move it by hand.
goto :end_error

:incomplete
echo.
echo   ERROR: the download is incomplete - some files are missing.
goto :cleanup_error

:corrupt
echo.
echo   ERROR: some files do not match their checksums (BAD above):
echo   the download is damaged.
goto :cleanup_error

:fail
echo ----------------------------------------------------------------
echo   ERROR: download failed, see the message above.
goto :cleanup_error

:cleanup_error
cd /d "%DEST%"
if exist "_downloading\" rmdir /s /q "_downloading"
echo   Nothing was saved. Run this file again.

:end_error
echo.
pause
exit /b 1
