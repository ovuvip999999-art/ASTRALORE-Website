plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.astralore.astra"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.astralore.astra"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // This app uses Android WebView and contains no ABI-specific native code.
    // The resulting APK is architecture-independent and works across supported Android ABIs.
}
