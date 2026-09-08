// 블룸 리그 매니저 — WebView 셸. 게임 본체는 web/dist/bloom.html (node web/build.mjs 산출물) 이고
// 빌드 때 앱 자산으로 복사한다. 빌드 절차: android/build-apk.sh
plugins {
    id("com.android.application")
}

fun git(vararg args: String): String = try {
    providers.exec { commandLine("git", *args) }.standardOutput.asText.get().trim()
} catch (e: Exception) { "" }
val gitCount = git("rev-list", "--count", "HEAD").toIntOrNull() ?: 1
val gitHash = git("rev-parse", "--short", "HEAD").ifEmpty { "dev" }

val bloomHtml = rootProject.file("../web/dist/bloom.html")
val bloomAssets = layout.buildDirectory.dir("bloomAssets")
val copyBloom by tasks.registering(Copy::class) {
    description = "web/dist/bloom.html → 앱 자산(assets/bloom.html)"
    doFirst {
        if (!bloomHtml.exists()) throw GradleException("web/dist/bloom.html 이 없습니다 — 먼저 node web/build.mjs 를 실행하세요")
    }
    from(bloomHtml)
    into(bloomAssets)
}

android {
    namespace = "app.bloomleague.manager"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.bloomleague.manager"
        minSdk = 24
        targetSdk = 34
        versionCode = gitCount
        versionName = "0.$gitCount ($gitHash)"
    }

    sourceSets["main"].assets.srcDir(bloomAssets)

    // 사이드로드용 서명 키(저장소에 포함). 같은 키로 서명해야 기존 설치 위에 갱신 설치가 된다.
    // 스토어 출시 키가 아니다 — 출시 때는 별도 키를 만들고 이 블록을 바꾼다.
    signingConfigs {
        create("sideload") {
            storeFile = rootProject.file("keystore/bloom-sideload.jks")
            storePassword = "bloomleague"
            keyAlias = "bloom"
            keyPassword = "bloomleague"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("sideload")
        }
        debug {
            signingConfig = signingConfigs.getByName("sideload")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

tasks.named("preBuild") { dependsOn(copyBloom) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
