#!/usr/bin/env bash
# 블룸 리그 매니저 APK 빌드 — web/dist/bloom.html 을 만들고 WebView 셸로 감싸 서명한다.
#   android/build-apk.sh            → web/dist/bloom-<hash>.apk
#   android/build-apk.sh --no-web   → HTML 빌드 생략(이미 만들어 둔 web/dist/bloom.html 사용)
# 필요: JDK 17+, Android SDK(ANDROID_HOME 또는 android/local.properties 의 sdk.dir), gradle(래퍼 ./gradlew 가 있으면 그것)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
if [[ "${1:-}" != "--no-web" ]]; then (cd "$ROOT" && node web/build.mjs --with-standee --no-hero); fi
if [[ -z "${ANDROID_HOME:-}" && ! -f "$HERE/local.properties" ]]; then
  for d in /opt/android-sdk "$HOME/Android/Sdk" "$HOME/Library/Android/sdk" /usr/lib/android-sdk; do
    if [[ -d "$d/platforms" ]]; then export ANDROID_HOME="$d"; break; fi
  done
fi
[[ -n "${ANDROID_HOME:-}" || -f "$HERE/local.properties" ]] || { echo "Android SDK 를 찾지 못했습니다 — ANDROID_HOME 을 지정하세요" >&2; exit 1; }
GRADLE="$HERE/gradlew"; [[ -x "$GRADLE" ]] || GRADLE="gradle"
(cd "$HERE" && "$GRADLE" --no-daemon -q assembleRelease)
HASH="$(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo dev)"
OUT="$ROOT/web/dist/bloom-$HASH.apk"
cp "$HERE/app/build/outputs/apk/release/app-release.apk" "$OUT"
echo "$(realpath --relative-to="$ROOT" "$OUT")  $(du -k "$OUT" | cut -f1)KB"
