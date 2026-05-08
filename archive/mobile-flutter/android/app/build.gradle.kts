import org.gradle.api.GradleException
import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    id("com.google.gms.google-services")
}

val releaseSigningProperties = Properties().apply {
    val keyPropertiesFile = rootProject.file("key.properties")
    if (keyPropertiesFile.exists()) {
        keyPropertiesFile.inputStream().use(::load)
    }
}

fun releaseSigningValue(key: String, envVar: String): String? {
    val environmentValue = providers.environmentVariable(envVar).orNull?.trim()
    if (!environmentValue.isNullOrEmpty()) {
        return environmentValue
    }

    return releaseSigningProperties.getProperty(key)?.trim()?.takeIf { it.isNotEmpty() }
}

val releaseKeystorePath = releaseSigningValue("storeFile", "RDV_ANDROID_KEYSTORE_PATH")
val releaseKeystorePassword = releaseSigningValue("storePassword", "RDV_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = releaseSigningValue("keyAlias", "RDV_ANDROID_KEY_ALIAS")
val releaseKeyPassword = releaseSigningValue("keyPassword", "RDV_ANDROID_KEY_PASSWORD")

val hasReleaseSigningConfig = listOf(
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrEmpty() }

val isReleaseBuildRequested = gradle.startParameter.taskNames.any {
    it.contains("Release", ignoreCase = true)
}

if (isReleaseBuildRequested && !hasReleaseSigningConfig) {
    throw GradleException(
        "Android release signing is not configured. Set RDV_ANDROID_KEYSTORE_PATH, " +
            "RDV_ANDROID_KEYSTORE_PASSWORD, RDV_ANDROID_KEY_ALIAS, and " +
            "RDV_ANDROID_KEY_PASSWORD, or provide the same values in mobile/android/key.properties."
    )
}

android {
    namespace = "com.remotedev.remote_dev"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    signingConfigs {
        create("release") {
            if (hasReleaseSigningConfig) {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.remotedev.remote_dev"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}

flutter {
    source = "../.."
}
