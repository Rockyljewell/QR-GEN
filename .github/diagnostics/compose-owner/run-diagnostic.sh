#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SUPPORT="$ROOT/.github/diagnostics/compose-owner"
OUT="${RUNNER_TEMP:?}/compose-owner-diagnostic"
SOURCE="$ROOT/packages/android/qrgen-compose/src/main/kotlin/dev/qrgen/compose/QRGenScanner.kt"
BACKUP="${RUNNER_TEMP:?}/qrgen-compose-owner-original.kt"
RESULTS="$ROOT/packages/android/qrgen-compose/build/test-results/testDebugUnitTest"
HTML="$ROOT/packages/android/qrgen-compose/build/reports/tests/testDebugUnitTest"
mkdir -p "$OUT/baseline" "$OUT/fixed"
cp -- "$SOURCE" "$BACKUP"

restore() {
  local status=$?
  trap - EXIT INT TERM
  cp -- "$BACKUP" "$SOURCE"
  python3 "$SUPPORT/verify-compose-owner.py" restored --repo "$ROOT" --out "$OUT" || status=1
  exit "$status"
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

python3 "$SUPPORT/verify-compose-owner.py" preflight --repo "$ROOT" --out "$OUT"
cp -- "$SUPPORT/source-pins.json" "$OUT/source-pins.json"
(
  cd "$ROOT/packages/android"
  ./gradlew --version
) > "$OUT/toolchain.log" 2>&1
(
  cd "$ROOT/packages/android"
  ./gradlew :qrgen-compose:dependencies --configuration debugUnitTestRuntimeClasspath -Pqrgen.android=true --no-daemon
) > "$OUT/dependency-resolution.log" 2>&1

run_phase() {
  local phase="$1"
  local status=0
  python3 "$SUPPORT/verify-compose-owner.py" source --phase "$phase" --repo "$ROOT" --out "$OUT"
  # Remove only this exact prior report so an earlier phase cannot supply stale XML.
  rm -f -- "$RESULTS/TEST-dev.qrgen.compose.QRGenScannerOwnershipTest.xml"
  (
    cd "$ROOT/packages/android"
    ./gradlew :qrgen-compose:testDebugUnitTest --tests dev.qrgen.compose.QRGenScannerOwnershipTest -Pqrgen.android=true --rerun-tasks --no-build-cache --stacktrace --no-daemon
  ) > "$OUT/$phase/gradle.log" 2>&1 || status=$?
  printf '%s\n' "$status" > "$OUT/$phase/gradle-exit.txt"
  if [[ ! -d "$RESULTS" ]]; then
    printf 'No JUnit output: a harness/dependency/build failure cannot prove the ownership bug.\n' >&2
    return 1
  fi
  cp -R -- "$RESULTS" "$OUT/$phase/junit"
  if [[ -d "$HTML" ]]; then cp -R -- "$HTML" "$OUT/$phase/html"; fi
  python3 "$SUPPORT/verify-compose-owner.py" results --phase "$phase" --exit-code "$status" --repo "$ROOT" --out "$OUT"
}

run_phase baseline
cp -- "$SUPPORT/QRGenScanner.fixed.kt" "$SOURCE"
run_phase fixed
cp -- "$BACKUP" "$SOURCE"
python3 "$SUPPORT/verify-compose-owner.py" restored --repo "$ROOT" --out "$OUT"
python3 "$SUPPORT/verify-compose-owner.py" summary --repo "$ROOT" --out "$OUT"
# EXIT trap independently restores/verifies the original bytes again on every exit path.
