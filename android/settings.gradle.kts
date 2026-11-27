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
    }
}

rootProject.name = "ashtar-transmissor"
include(":app")
