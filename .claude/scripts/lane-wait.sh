#!/usr/bin/env bash
# Wait for one Codex lane started by codex-lane.sh and notice a silent hang: a lane whose log has
# not grown for STALL_MINUTES (default 20) is reported as stalled, because a live Codex run writes
# to its log every few seconds. On 2026-10-16 a lane sat seven hours on "Reading additional input
# from stdin..." while a pid-only wait saw a healthy process.
# usage: lane-wait.sh <issue> [pid]   (pid defaults to the issue's line in $S/running)
# Exit 0 when the lane exits, 2 when it is stalled (the process is left running: inspect the log,
# then kill it and relaunch with codex-lane.sh or finish the lane with an implementer agent).
set -u
S=${CODEX_LANE_DIR:-$HOME/.cache/frejsi-codex-lanes}
N=$1
PID=${2:-$(awk -v n="$N" '$1==n {p=$2} END {print p}' "$S/running")}
LOG=$S/log-$N.txt
STALL=$(( ${STALL_MINUTES:-20} * 60 ))
last_size=-1; last_change=$(date +%s)
while kill -0 "$PID" 2>/dev/null; do
  size=$(stat -c %s "$LOG" 2>/dev/null || echo 0)
  now=$(date +%s)
  if [ "$size" != "$last_size" ]; then last_size=$size; last_change=$now; fi
  if [ $((now - last_change)) -ge "$STALL" ]; then
    echo "lane $N STALLED: log unchanged for $(( (now - last_change) / 60 )) min (pid $PID); last lines:"
    tail -c 400 "$LOG"
    exit 2
  fi
  sleep 30
done
echo "lane $N exited at $(date -u +%H:%M:%SZ)"
tail -c 1500 "$S/final-$N.md" 2>/dev/null
