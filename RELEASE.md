# 출시 준비 — 가난한자의 FM

Google Play 출시를 위한 체크리스트. **저장소에서 끝난 것**과 **사람이 직접 해야 하는 것**을 나눠 둡니다.

---

## 1. 저장소에서 끝난 것

| 항목 | 상태 |
|---|---|
| 앱 이름 | `가난한자의 FM` — 런처, 액티비티, 웹 매니페스트, 문서 제목 전부 일치 |
| 개발 코드네임 노출 | 없음. 게임 안 컵 대회가 `3sec 컵` → **`대한컵`** |
| `targetSdkVersion` | **36** (Play는 2026-08-31부터 신규 앱에 36 이상을 요구. 첫 업로드에서 35가 거부됐음) |
| `compileSdkVersion` | 36 (Android Gradle Plugin 8.9.2 / Gradle 8.11.1) |
| `minSdkVersion` | 22 (Android 5.1, 실사용 기기의 99% 이상) |
| 버전 | `versionCode 32` / `versionName "1.0"` |
| 업로드 서명 | `keystore.properties` 또는 환경변수에서 읽도록 배선. 키는 저장소에 **없고**, `.gitignore`가 막고 있음 |
| AAB 빌드 | `pnpm --filter viewer android:bundle` → `android/app/build/outputs/bundle/release/app-release.aab` (7.9MB) |
| 네트워크 의존 | **없음**. 구글 폰트 CDN을 쓰던 것을 앱에 넣음 (아래 참조) |
| 뒤로가기 버튼 | 열린 것을 닫고, 홈에서만 두 번 눌러 종료. 경기 중에는 무시 |
| 경기 중 화면 꺼짐 | 웨이크 락으로 방지 |
| 백그라운드 저장 | 앱이 내려갈 때 저장 |
| 개발자용 UI | 엔진 오버레이를 경기 툴바에서 뺌 (설정의 버전 줄을 길게 눌러야 나옴) |
| 설정의 버전 표기 | `v0.24` → `v1.0` (실제 빌드와 어긋나 있었음) |
| 첫 실행 | 설명서 대신 **프롤로그 「첫 출근」**: 0:1로 끌려가는 후반 45분을 맡아 라커룸·전술·마지막 지시를 4분 안에 겪음 (건너뛰기 가능). 그 뒤 감독실 환영 시트 |
| 빈 감독 이름 | `감독 감독`으로 표시되던 것 → 기본값 `신임` (→ "신임 감독") |
| 개막 전 표시 | 순위 `5위`·신문 `광주 선두`가 0경기에 뜨던 것 → `개막전`·`리그 개막` |
| 경기 화면 | 아이콘 10개짜리 레일에 글자 캡션(재생·결과로·크게·소리·진동·리플레이·이름표·자막·전술) |
| 킥오프 안내 | 라인업 카드 뒤 정적 화면 → "▶ 을 누르면 시작합니다 · ☰ 에서 전술과 교체" 자막 |
| 킥오프 배너 | 중계 스코어버그와 겹치던 것 → 그 아래로 |
| 난이도 문구 | `설계된 그대로`(개발자 말투) → `기본` |
| 세로 경기 화면 | 피치 아래 빈 관중석 띠(148px)에 **경기 기록 패널**(점유율·슈팅·xG·패스). 띠가 118px 미만인 짧은 폰과 가로 모드에선 숨김 |
| 서드파티 라이선스 | `apps/viewer/public/fonts/OFL.txt` (SIL OFL 1.1) |

### 폰트를 앱에 넣은 이유
출시 전까지 이 게임은 **실행할 때마다 구글에 폰트를 요청**했습니다. 지하철에서 켜면 글꼴이 깨지고,
아무와도 통신하지 않는 앱에 제3자가 하나 끼어 있는 상태였습니다. fontTools로 서브셋해서 넣었습니다:

- 표시·모노 서체(Barlow Condensed, IBM Plex Mono) — 라틴만, 합계 30KB
- 본문 서체(IBM Plex Sans KR) — **한글 음절 11,172자 전부**, 굵기 2종 790KB

전체를 넣은 이유는 플레이어가 구단명·감독명을 직접 입력하기 때문입니다. 소스에 등장하는 824자만
넣으면 사용자가 친 글자가 두부(□)로 나옵니다. 전부 넣어도 790KB라 그럴 이유가 없었습니다.

**검증**: 자기 출처 외의 모든 요청을 차단한 상태로 실행 — 차단된 요청 0건, 폰트 5종 전부 로드,
소스에 없는 한글(`뷁뛟쭑핥`)도 폴백이 아닌 Plex로 렌더.

---

## 2. 사람이 해야 하는 것

### 2-1. 업로드 키 (가장 중요 — 잃어버리면 앱을 영영 업데이트할 수 없습니다)

**컴퓨터가 없을 때 (원격 개발만 할 때):** GitHub Actions가 대신 만듭니다.
1. 저장소 → **Actions → 업로드 키 만들기 → Run workflow**. 끝나면 그 실행 페이지 아래 **Artifacts → upload-keystore** 내려받기 (24시간 뒤 사라짐).
2. 그 zip을 **Google Drive 개인 폴더**와 **비밀번호 관리자**에 보관.
3. zip 안 `README.txt`의 두 값을 **Settings → Secrets and variables → Actions**에 넣기: `UPLOAD_KEYSTORE_PASSWORD`, `UPLOAD_KEYSTORE_B64`.
4. **Actions → Android 릴리스 → Run workflow** → Artifacts에서 서명된 `.aab`/`.apk` 내려받기 → Play Console에 업로드.

**한 줄로 끝내기:** 본인 컴퓨터에서 `bash scripts/make-upload-key.sh`. 강한 비밀번호를 만들고,
`~/upload-keystore.jks`를 생성하고, `keystore.properties`를 쓰고, `~/upload-keystore-backup/`에
키·비밀번호·지문을 모아 두고, `ANDROID_HOME`이 있으면 서명된 AAB까지 빌드합니다. 그 백업 폴더를
**서로 다른 두 곳**(예: Google Drive 개인 폴더 + 비밀번호 관리자)에 올리세요. 아래는 손으로 할 때의 순서입니다.

```bash
keytool -genkey -v -keystore ~/upload-keystore.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias upload
```

만든 뒤 `apps/viewer/android/keystore.properties`에 경로와 비밀번호를 적습니다
(이 파일은 `.gitignore`에 있습니다):

```properties
storeFile=/절대/경로/upload-keystore.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

그러면 `android:bundle`이 서명된 AAB를 냅니다. **키 파일과 비밀번호를 저장소 밖에 따로 백업하세요.**
Play Console에서 Play 앱 서명(Play App Signing)을 켜면 배포 키는 구글이 보관하고, 이 업로드 키는
업로드 인증에만 쓰입니다 — 그래도 잃으면 재발급 절차를 밟아야 합니다.

### 2-2. 기기에서 한 번은 돌려볼 것

이 컨테이너에는 안드로이드 기기가 없어 실제 설치 확인을 못 했습니다. 제출 전에 서명된 빌드를
실기기에 넣고 최소한 이것들을 확인하세요:

- 첫 실행 → 구단 선택 → 경기 한 판 → 저장 후 재실행 시 이어지는지
- 가로/세로 회전, 뒤로가기 버튼
- 글꼴이 의도대로 나오는지 (비행기 모드에서도)

### 2-3. INTERNET 권한 (선택)

게임은 이제 네트워크를 전혀 쓰지 않지만 `INTERNET` 권한이 남아 있습니다. Capacitor 6은 로컬
WebView 인터셉트로 파일을 서빙하므로 이론상 필요 없지만, **실기기 확인 없이 지우면 흰 화면이 될
위험**이 있어 남겨 뒀습니다. 2-2에서 확인한 뒤 지우고 싶다면
`apps/viewer/android/app/src/main/AndroidManifest.xml`의 해당 줄을 지우고 다시 확인하세요.
권한이 남아 있어도 Play 심사나 데이터 안전 섹션에 불리하지 않습니다.

### 2-4. Play Console 제출물

| 항목 | 내용 |
|---|---|
| 앱 이름 | 가난한자의 FM |
| 카테고리 | 게임 → 스포츠 |
| 콘텐츠 등급 | 전체이용가. 폭력·성적 내용·도박·사용자 간 소통 **전부 없음**으로 답하면 됩니다 |
| 데이터 안전 | **수집·공유하는 데이터 없음**. 세이브는 기기 안 `localStorage`에만 있고 서버가 없습니다 |
| 광고 | 없음 |
| 인앱 결제 | 없음 |
| 개인정보처리방침 | **URL 필수** — 수집하는 데이터가 없어도 Play는 링크를 요구합니다. 초안은 `PRIVACY.md` |
| 아이콘 | 512×512 PNG — `apps/viewer/public/icons/icon-512.png` |
| 그래픽 이미지 | 1024×500 PNG — `docs/store/feature-graphic.png` (원본 `feature-graphic.html`) |
| 스크린샷 | 휴대전화 2장 이상 (16:9 또는 9:16, 최소 320px) — `docs/store/` 참조 |

### 2-5. 남은 제작물

전부 `docs/store/`에 있습니다 — 피처 그래픽, 스크린샷 10장, 설명 문구 초안.

---

## 3. 출시 빌드 만드는 법

```bash
# 서명된 AAB (Play에 올리는 것)
ANDROID_HOME=/path/to/sdk pnpm --filter viewer android:bundle

# 서명된 APK (직접 배포·테스트용)
ANDROID_HOME=/path/to/sdk pnpm --filter viewer android:release
```

버전을 올릴 때는 `apps/viewer/android/app/build.gradle`의 `versionCode`(정수, 매번 증가)와
`versionName`(표시용 문자열)을 함께 고칩니다.

## 4. Play 자동 업로드 (한 번만 설정)

`Android 릴리스` 워크플로는 Secrets 에 `PLAY_SERVICE_ACCOUNT_JSON` 이 있으면 빌드한 AAB 를
Play 의 내부 테스트 트랙(또는 Run workflow 에서 고른 트랙)에 바로 올립니다. 없으면 그 단계만 건너뜁니다.
첫 번째 AAB 는 Play 정책상 Console 화면에서 직접 올려야 하고, 그 뒤부터 자동화가 됩니다.

1. Play Console → 왼쪽 맨 아래 **설정 → API 액세스** → "Google Cloud 프로젝트 연결"에서 새 프로젝트 만들기.
2. 같은 화면의 **서비스 계정 → 새 서비스 계정 만들기** → 안내대로 Google Cloud Console 이 열리면
   서비스 계정 이름(예: `play-upload`)을 정하고 만듭니다. 역할은 주지 않아도 됩니다.
3. Cloud Console 에서 그 서비스 계정 → **키 → 키 추가 → 새 키 만들기 → JSON** → 내려받습니다.
4. Play Console 의 API 액세스 화면으로 돌아와 **"액세스 권한 관리"** → 방금 계정을 앱 `가난한자의 FM` 에
   추가하고 권한은 **"출시 → 프로덕션·테스트 트랙에 출시" 와 "앱 정보 보기"** 를 켭니다. (계정 수준
   권한 "릴리스 관리자"를 주면 한 번에 됩니다.)
5. GitHub → Settings → Secrets and variables → Actions → New repository secret →
   이름 `PLAY_SERVICE_ACCOUNT_JSON`, 값은 JSON 파일 **내용 전체**를 붙여넣기.
6. Actions → Android 릴리스 → Run workflow. 끝나면 Play Console → 내부 테스트에 새 버전이 보입니다.

권한 반영에 최대 24시간이 걸린다는 안내가 나오지만 보통 몇 분이면 됩니다. "The caller does not have
permission" 이 나오면 4번의 권한이 아직 안 붙은 것입니다.

출시 노트는 `apps/viewer/android/whatsnew/whatsnew-ko-KR` 파일이 그대로 올라갑니다. 버전마다 고치세요.
