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
        // Cada run do CI um número maior: o APK novo instala por cima do antigo.
        versionCode = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionName = "0.1.0"
        buildConfigField("String", "DEFAULT_API_URL", "\"${ashtarApiUrl.replace("\"", "")}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // A chave fixa do Transmissor, dos segredos do GitHub (o CI a escreve em `transmissor.jks`):
    // assinado sempre com ela, o APK novo instala por cima do antigo sem desparear. Sem ela (um build
    // local, ou o CI sem os segredos), sai com a chave de debug da máquina.
    val keystore = file("transmissor.jks")
    val keystorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD").orEmpty()
    val fixedKey = keystore.exists() && keystorePassword.isNotEmpty()
    signingConfigs {
        if (fixedKey) {
            create("transmissor") {
                storeFile = keystore
                storePassword = keystorePassword
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")?.takeIf { it.isNotBlank() } ?: "transmissor"
                keyPassword = keystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (fixedKey) "transmissor" else "debug")
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
