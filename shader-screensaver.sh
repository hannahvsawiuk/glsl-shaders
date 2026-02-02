#!/bin/bash

# Shader Screensaver Script (setlist mode)
# Runs a list of shell commands in order, each for a specified duration.
# Edit setlist.conf to define: DURATION_SECONDS  COMMAND (one per line).
# Loops forever through the setlist.
# Background jobs are run in their own process group so we can kill the whole group (subshell + glslViewer).

set -m
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETLIST_FILE="${SETLIST_FILE:-$SCRIPT_DIR/setlist.conf}"
LOG_FILE="${LOG_FILE:-$SCRIPT_DIR/shader-screensaver.log}"
# Seconds to keep previous shader running after starting the next (avoids desktop flash between shaders)
OVERLAP_SEC="${OVERLAP_SEC:-3}"
export SCRIPT_DIR

# Use :0 when DISPLAY is not set (cron, systemd, SSH without -X, or any non-graphical session).
# Override with DISPLAY=:1 etc. if your display is different.
if [ -z "${DISPLAY:-}" ]; then
    export DISPLAY=:0
fi

# Default to example if no setlist.conf (so user can copy and edit)
if [ ! -f "$SETLIST_FILE" ]; then
    if [ -f "$SCRIPT_DIR/setlist.conf.example" ]; then
        SETLIST_FILE="$SCRIPT_DIR/setlist.conf.example"
        echo "No setlist.conf found; using setlist.conf.example. Copy to setlist.conf to customize."
    else
        echo "Error: No setlist file found. Create $SCRIPT_DIR/setlist.conf with lines: DURATION  COMMAND"
        exit 1
    fi
fi

echo "Shader Screensaver (setlist) starting..."
echo "Setlist: $SETLIST_FILE"
echo "Working directory: $SCRIPT_DIR"
echo "Log (commands + stderr): $LOG_FILE"

CURRENT_PID=""
PREVIOUS_PID=""

# Kill process group (subshell + glslViewer child). Negative PID = process group when job control is on.
kill_group() {
    local pid="$1"
    [ -z "$pid" ] && return
    if ps -p "$pid" > /dev/null 2>&1; then
        kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
        for _ in 1 2 3 4 5; do
            ps -p "$pid" > /dev/null 2>&1 || return
            sleep 0.5
        done
        kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
    fi
}

cleanup() {
    echo "Stopping shader screensaver..."
    kill_group "$PREVIOUS_PID"
    kill_group "$CURRENT_PID"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

run_setlist() {
    while true; do
        local line_num=0
        while IFS= read -r line || [ -n "$line" ]; do
            line_num=$((line_num + 1))
            # Trim; skip empty and comment lines
            line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
            [ -z "$line" ] && continue
            [ "${line#\#}" != "$line" ] && continue

            # Join continuation lines (lines ending with \)
            while [[ "$line" == *\\ ]]; do
                line="${line%\\}"
                line="$(echo "$line" | sed 's/[[:space:]]*$//')"
                IFS= read -r nextline || true
                nextline="$(echo "$nextline" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
                line="${line} ${nextline}"
                line_num=$((line_num + 1))
            done

            local duration="${line%% *}"
            local command="${line#* }"
            if [ -z "$duration" ] || [ -z "$command" ]; then
                echo "Skipping invalid setlist line $line_num: $line"
                continue
            fi
            if ! [[ "$duration" =~ ^[0-9]+$ ]]; then
                echo "Skipping setlist line $line_num (invalid duration): $line"
                continue
            fi

            echo "$(date '+%Y-%m-%d %H:%M:%S') - Running for ${duration}s: $command"
            (
                echo "---"
                echo "$(date '+%Y-%m-%d %H:%M:%S') - Entry (${duration}s): $command"
                cd "$SCRIPT_DIR" && eval "$command"
            ) < /dev/null >> "$LOG_FILE" 2>&1 &
            CURRENT_PID=$!

            if [ -n "$PREVIOUS_PID" ] && ps -p "$PREVIOUS_PID" > /dev/null 2>&1; then
                # New shader is running; keep previous for OVERLAP_SEC so transition is smooth, then kill its process group
                sleep "$OVERLAP_SEC"
                kill_group "$PREVIOUS_PID"
                # Remainder of this entry's duration
                remain=$((duration - OVERLAP_SEC))
                [ "$remain" -gt 0 ] && sleep "$remain"
            else
                sleep "$duration"
            fi

            # Hand off current to previous; next iteration will kill it after overlap
            PREVIOUS_PID=$CURRENT_PID
            CURRENT_PID=""
        done < "$SETLIST_FILE"
        echo "$(date '+%Y-%m-%d %H:%M:%S') - Setlist complete; looping..."
    done
}

run_setlist
