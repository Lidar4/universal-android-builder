@echo off
rem Universal Android Builder - Gradle Wrapper Bootstrap Batch Script
rem This script ensures gradle-wrapper.jar is present and runs the Gradle build.

set DIR=%~dp0
set WRAPPER_DIR=%DIR%gradle\wrapper
set WRAPPER_JAR=%WRAPPER_DIR%\gradle-wrapper.jar

if not exist "%WRAPPER_DIR%" mkdir "%WRAPPER_DIR%"

if not exist "%WRAPPER_JAR%" (
    echo gradle-wrapper.jar not found. Bootstrapping Gradle Wrapper...
    echo Downloading Gradle Wrapper Jar from official repository...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://raw.githubusercontent.com/gradle/gradle/v8.5/gradle/wrapper/gradle-wrapper.jar', '%WRAPPER_JAR%')"
)

where java >nul 2>nul
if %ERRORLEVEL% equ 0 (
    java -Xmx2048m -jar "%WRAPPER_JAR%" %*
) else (
    echo Java not found. Attempting to use system gradle...
    where gradle >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        gradle %*
    ) else (
        echo Error: Neither Java nor system gradle was found. Cannot build project.
        exit /b 1
    )
)
