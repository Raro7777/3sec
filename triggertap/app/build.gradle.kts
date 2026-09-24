plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.triggertap.probe"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.triggertap.probe"
        minSdk = 34
        targetSdk = 36
        versionCode = 2
        versionName = "0.0.2-probe"
    }

    signingConfigs {
        // A committed debug key so each CI build installs over the previous one.
        // It signs debug builds only and protects nothing.
        getByName("debug") {
            storeFile = rootProject.file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
