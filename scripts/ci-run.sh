#!/usr/bin/env bash
# Runs a build command; on failure, reports the important part of its output
# as a GitHub error annotation, so it shows on the run's summary page.
#   scripts/ci-run.sh <title> <command...>
set -uo pipefail
title="$1"
shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  err="$(mktemp)"
  # Kotlin/Java compiler errors, Gradle's summary, npm/electron-builder errors.
  grep -E "^e: |error:|error TS|What went wrong|Could not|FAILURE|⨯|Error:|ERR!" -A8 "$log" | head -120 > "$err"
  [ -s "$err" ] || tail -100 "$log" > "$err"
  msg="$(sed -e 's/%/%25/g' -e 's/\r/%0D/g' "$err" | sed ':a;N;$!ba;s/\n/%0A/g')"
  echo "::error title=${title}::${msg}"
  # A second annotation with the tail, in case the error was further down.
  tailmsg="$(tail -60 "$log" | sed -e 's/%/%25/g' -e 's/\r/%0D/g' | sed ':a;N;$!ba;s/\n/%0A/g')"
  echo "::error title=${title} (end of log)::${tailmsg}"
fi
exit "$status"
