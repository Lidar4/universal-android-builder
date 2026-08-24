#!/usr/bin/env bash

# Universal Android Builder - Gradle Wrapper Bootstrap Script
# This script ensures gradle-wrapper.jar is present and runs the Gradle build.

set -e

# Set directory variables
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER_DIR="$DIR/gradle/wrapper"
WRAPPER_JAR="$WRAPPER_DIR/gradle-wrapper.jar"
PROPERTIES_FILE="$WRAPPER_DIR/gradle-wrapper.properties"

# Ensure gradle/wrapper directory exists
mkdir -p "$WRAPPER_DIR"

# Download gradle-wrapper.jar if it is missing
if [ ! -f "$WRAPPER_JAR" ]; then
    echo "gradle-wrapper.jar not found. Bootstrapping Gradle Wrapper..."
    # Parse gradle version from properties if exists, default to 8.5
    GRADLE_VERSION="8.5"
    if [ -f "$PROPERTIES_FILE" ]; then
        VERSION_LINE=$(grep "distributionUrl" "$PROPERTIES_FILE")
        if [[ $VERSION_LINE =~ gradle-([0-9.]+) ]]; then
            GRADLE_VERSION="${BASH_REMATCH[1]}"
        fi
    fi
    JAR_URL="https://raw.githubusercontent.com/gradle/gradle/v$GRADLE_VERSION/gradle/wrapper/gradle-wrapper.jar"
    echo "Downloading Gradle Wrapper Jar v$GRADLE_VERSION from GitHub..."
    
    # Try curl first, then wget
    if command -v curl >/dev/null 2>&1; then
        curl -L -o "$WRAPPER_JAR" "$JAR_URL"
    elif command -v wget >/dev/null 2>&1; then
        wget -O "$WRAPPER_JAR" "$JAR_URL"
    else
        echo "Error: curl or wget is required to bootstrap the Gradle Wrapper." >&2
        exit 1
    fi
fi

# Run the standard java command if available, or fall back to system gradle
if command -v java >/dev/null 2>&1; then
    exec java -Xmx2048m -jar "$WRAPPER_JAR" "$@"
else
    echo "Java not found. Attempting to use system gradle..."
    if command -v gradle >/dev/null 2>&1; then
        exec gradle "$@"
    else
        echo "Error: Neither Java nor system gradle was found. Cannot build project." >&2
        exit 1
    fi
fi
