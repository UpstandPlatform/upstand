plugins {
    kotlin("jvm") version "2.0.0"
    application
}

application {
    mainClass.set("MainKt")
}

// Single runnable fat jar in build/libs (no separate -plain jar), so the
// `java -jar build/libs/*.jar` start command is unambiguous.
tasks.jar {
    manifest { attributes["Main-Class"] = "MainKt" }
    from({ configurations.runtimeClasspath.get().map { if (it.isDirectory) it else zipTree(it) } })
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
}

repositories { mavenCentral() }
