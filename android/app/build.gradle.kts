plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/** O endereço da API que vem preenchido na tela de parear (`-PashtarApiUrl=https://...`). */
val ashtarApiUrl: String = (findProperty("ashtarApiUrl") as String?).orEmpty().trim()

android {
    namespace = "com.gustavo99g.ashtar.transmissor"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.gustavo99g.ashtar.transmissor"
        // O Android 10 é o primeiro com a captura do áudio dos apps (AudioPlaybackCapture).
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "DEFAULT_API_URL", "\"${ashtarApiUrl.replace("\"", "")}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Sem chave de assinatura própria, o release sai com a de debug: o APK é instalado à mão.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("io.livekit:livekit-android:2.31.0")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
