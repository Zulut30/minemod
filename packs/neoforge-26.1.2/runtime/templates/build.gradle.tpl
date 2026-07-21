plugins {
    id 'java-library'
    id 'net.neoforged.moddev' version '2.0.141'
}

group = 'dev.mcdev.generated'
version = '@@MCDEV_PROJECT_VERSION@@'

base {
    archivesName = '@@MCDEV_MOD_ID@@'
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

neoForge {
    version = '26.1.2.80'

    mods {
        @@MCDEV_MOD_ID@@ {
            sourceSet(sourceSets.main)
        }
    }
}

tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
    options.release = 25
}

tasks.withType(AbstractArchiveTask).configureEach {
    preserveFileTimestamps = false
    reproducibleFileOrder = true
}
