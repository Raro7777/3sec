#!/usr/bin/env bash
# 업로드 키 만들기 — 한 번만, 본인 컴퓨터에서.
#
# 하는 일:
#   1. keytool을 찾는다 (PATH, 없으면 Android Studio에 든 JDK)
#   2. 강한 비밀번호를 만든다 (직접 정하고 싶으면 KEY_PASSWORD=... 로 넘긴다)
#   3. ~/upload-keystore.jks 를 만든다 (이미 있으면 절대 덮어쓰지 않는다)
#   4. apps/viewer/android/keystore.properties 를 쓴다 (gitignore 되어 있다)
#   5. 백업 폴더 ~/upload-keystore-backup/ 에 키 + 비밀번호 + 지문을 모아 둔다
#   6. ANDROID_HOME이 있으면 서명된 AAB까지 빌드한다
#
# 이 스크립트는 비밀번호를 터미널에 한 번 보여 주고, 백업 폴더의 README에 적는다. 그 폴더를
# 서로 다른 두 곳(비밀번호 관리자 + 외장/클라우드 개인 폴더)에 복사한 뒤 원하면 지워도 된다.
# 키를 잃으면 이 앱을 다시는 업데이트할 수 없다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KS="${KEYSTORE_PATH:-$HOME/upload-keystore.jks}"
ALIAS="upload"
PROPS="$ROOT/apps/viewer/android/keystore.properties"
BACKUP="$HOME/upload-keystore-backup"

# ---- 1. keytool
find_keytool() {
  if command -v keytool >/dev/null 2>&1; then command -v keytool; return; fi
  for c in \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" \
    "$HOME/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" \
    "/c/Program Files/Android/Android Studio/jbr/bin/keytool.exe" \
    "$LOCALAPPDATA/Programs/Android Studio/jbr/bin/keytool.exe" \
    "${JAVA_HOME:-/nonexistent}/bin/keytool" \
    "/opt/android-studio/jbr/bin/keytool" ; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
  echo ""
}
KEYTOOL="$(find_keytool)"
if [ -z "$KEYTOOL" ]; then
  echo "keytool을 찾지 못했습니다. Android Studio를 설치했다면 그 안의 JDK 경로를 JAVA_HOME으로 주세요." >&2
  echo "  예) JAVA_HOME=\"/Applications/Android Studio.app/Contents/jbr/Contents/Home\" $0" >&2
  exit 1
fi

# ---- 2. 비밀번호
if [ -n "${KEY_PASSWORD:-}" ]; then
  PW="$KEY_PASSWORD"
elif command -v openssl >/dev/null 2>&1; then
  PW="$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-24)"
else
  PW="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
fi

# ---- 3. 키
if [ -e "$KS" ]; then
  echo "이미 키가 있습니다: $KS" >&2
  echo "덮어쓰지 않습니다. 새로 만들려면 먼저 그 파일을 다른 곳으로 옮기세요 (지우지 말고)." >&2
  exit 1
fi
NAME="${KEY_OWNER:-Raro}"
"$KEYTOOL" -genkey -v -keystore "$KS" -keyalg RSA -keysize 2048 -validity 10000 -alias "$ALIAS" \
  -storepass "$PW" -keypass "$PW" \
  -dname "CN=$NAME, OU=Game, O=Poor Mans FM, L=Seoul, ST=Seoul, C=KR" >/dev/null
chmod 600 "$KS"
echo "키 생성: $KS"

# ---- 4. 빌드가 읽을 설정 (gitignore 됨)
cat > "$PROPS" <<PROPS_EOF
storeFile=$KS
storePassword=$PW
keyAlias=$ALIAS
keyPassword=$PW
PROPS_EOF
chmod 600 "$PROPS"
echo "설정 작성: $PROPS"
if git -C "$ROOT" check-ignore -q "$PROPS"; then :; else
  echo "경고: keystore.properties가 gitignore에 없습니다. 커밋되지 않게 .gitignore를 확인하세요." >&2
fi

# ---- 5. 백업 폴더
mkdir -p "$BACKUP"
cp "$KS" "$BACKUP/"
FP="$("$KEYTOOL" -list -v -keystore "$KS" -storepass "$PW" 2>/dev/null | grep 'SHA256:' | head -1 | sed 's/^[[:space:]]*//')"
cat > "$BACKUP/README.txt" <<README_EOF
가난한자의 FM — 업로드 키 (dev.threesec.fm)
만든 날: $(date +%Y-%m-%d)

파일:        upload-keystore.jks
alias:       $ALIAS
비밀번호:    $PW
(저장소 비밀번호와 키 비밀번호가 같습니다)
$FP

이 폴더를 서로 다른 두 곳에 보관하세요:
  1) 비밀번호 관리자 (첨부 + 비밀번호)
  2) 외장 드라이브 또는 클라우드의 개인 폴더
git 저장소에는 절대 넣지 마세요. 잃어버리면 앱을 영영 업데이트할 수 없습니다.
README_EOF
chmod -R go-rwx "$BACKUP"
echo "백업 폴더: $BACKUP  (README.txt에 비밀번호와 지문)"

echo
echo "================ 지금 적어 두세요 ================"
echo "  keystore : $KS"
echo "  alias    : $ALIAS"
echo "  password : $PW"
echo "  $FP"
echo "=================================================="
echo

# ---- 6. 서명된 AAB
if [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME" ]; then
  echo "서명된 AAB를 빌드합니다…"
  ( cd "$ROOT" && pnpm --filter viewer android:bundle >/tmp/aab-build.log 2>&1 ) && \
    echo "완료: $ROOT/apps/viewer/android/app/build/outputs/bundle/release/app-release.aab" || \
    { echo "빌드 실패 — /tmp/aab-build.log 를 보세요" >&2; exit 1; }
else
  echo "ANDROID_HOME이 없어 AAB 빌드는 건너뜁니다. 준비되면:"
  echo "  ANDROID_HOME=/path/to/sdk pnpm --filter viewer android:bundle"
fi
