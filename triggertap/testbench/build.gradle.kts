plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.triggertap.testbench"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.triggertap.testbench"
        minSdk = 34
        targetSdk = 36
        versionCode = 4
        versionName = "0.0.4-testbench"
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
