# android/ — 안드로이드 WebView 셸

`web/dist/bloom.html`(단일 HTML 게임)을 안드로이드 앱으로 감싼 프로젝트다. **게임 코드는 여기 없다** — 빌드 때
HTML 을 `assets/bloom.html` 로 복사해 WebView 로 띄우는 액티비티 하나(`MainActivity.java`)와 아이콘·서명 키뿐이다.

## 만들기

```bash
android/build-apk.sh            # node web/build.mjs → gradle assembleRelease → web/dist/bloom-<hash>.apk
android/build-apk.sh --no-web   # 이미 만든 web/dist/bloom.html 로
```

필요한 것: JDK 17 이상, Android SDK(platforms;android-34 · build-tools;34.0.0). SDK 는 `ANDROID_HOME` 또는
`android/local.properties` 의 `sdk.dir=` 로 알려 준다. 첫 빌드는 Gradle 플러그인·androidx.webkit 을 내려받는다.
Android Studio 에서는 `android/` 폴더를 열면 된다(Gradle 8.14 래퍼 포함).

## 폰에 설치(사이드로드)

1. APK 파일을 폰으로 옮긴다(메신저·드라이브·다운로드).
2. 파일을 누르면 "출처를 알 수 없는 앱" 허용을 묻는다 — 그 앱(파일 관리자·브라우저)에 한 번 허용.
3. Play 프로텍트가 "알 수 없는 개발자" 경고를 낼 수 있다 — 스토어 앱이 아니라서 뜨는 것이고, 그대로 설치.
4. 같은 키로 서명한 새 APK 는 **기존 앱 위에 그대로 설치**되고 세이브가 유지된다(지우고 다시 깔 필요 없음).

## 동작

- 자산은 `https://appassets.androidplatform.net/assets/bloom.html` 로 서빙한다(`WebViewAssetLoader`). `file://` 가 아니라
  https 오리진이라 localStorage(세이브 `bloom-manager-save-v1` 등)가 안정적으로 남는다.
- 뒤로가기: 페이지의 `window.bloomBack()`(app-shell) 이 처리하면 끝, 아니면 "한 번 더 누르면 종료".
- 세로 고정, 시스템 글자 크기 무시(`textZoom 100`), 확대 금지, 외부 링크는 브라우저로.
- 권한은 `VIBRATE`(햅틱) 하나. 네트워크는 쓰지 않는다.
- `versionCode` = 커밋 수, `versionName` = `0.<커밋 수> (<짧은 해시>)`. 앱 정보에서 어느 빌드인지 읽을 수 있다.

## 서명 키

`keystore/bloom-sideload.jks`(별칭 `bloom`, 비밀번호 `bloomleague`)는 **사이드로드 테스트용**이고 일부러 저장소에 둔다 —
어느 환경에서 빌드해도 같은 서명이라 갱신 설치가 된다. 스토어 출시 때는 새 키를 만들어 `app/build.gradle.kts` 의
`signingConfigs` 를 바꾸고, 이 키는 쓰지 않는다.
