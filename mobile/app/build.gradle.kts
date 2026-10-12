import java.net.URI
import java.util.Properties

plugins {
    id("com.android.application")
}

/**
 * Tick for Android: a Trusted Web Activity, which opens the hosted site in Chrome itself, full screen,
 * with no address bar once the site vouches for this app (see build-apk.sh, which writes the file the
 * site serves for that). It is not a WebView: Google refuses to sign anyone in from inside one, and
 * Chrome keeps Google sign-in, passkeys and wallets working.
 *
 * The address is a build input, not a constant: ./build-apk.sh https://your-site.example
 */
val tickUrl: String = (project.findProperty("tickUrl") as String?) ?: "https://tick.example"
val tickHost: String = URI(tickUrl).host
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "app.tick.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.tick.mobile"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        manifestPlaceholders["tickUrl"] = tickUrl
        manifestPlaceholders["tickHost"] = tickHost
        resValue("string", "asset_statements", """[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"web","site":"$tickUrl"}}]""")
    }

    signingConfigs {
        create("release") {
            if (keystoreProps.isNotEmpty()) {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
