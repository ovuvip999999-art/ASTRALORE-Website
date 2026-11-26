plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val releaseStoreFile = System.getenv("ASTRA_KEYSTORE_PATH")
val releaseStorePassword = System.getenv("ASTRA_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("ASTRA_KEY_ALIAS")
val releaseKeyPassword = System.getenv("ASTRA_KEY_PASSWORD")
val hasReleaseSigning = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword
).all { !it.isNullOrBlank() }

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

    if (hasReleaseSigning) {
        signingConfigs {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword!!
                keyAlias = releaseKeyAlias!!
                keyPassword = releaseKeyPassword!!
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
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
