// O Transmissor do Ashtar (ADR 0038): o APK que transmite a tela do Odin 3 para onde o dono está.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // A LiveKit usa um fork do `audioswitch` publicado só no JitPack.
        maven("https://jitpack.io") {
            content { includeGroup("com.github.davidliu") }
        }
    }
}

rootProject.name = "ashtar-transmissor"
include(":app")
