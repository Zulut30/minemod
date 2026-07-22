package dev.mcdev.fixture.fabricempty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class SmokeReadinessTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void absentNonceDoesNotPublishSentinel() {
        Path temporaryPath = temporaryDirectory.resolve("ready.tmp");
        Path readinessPath = temporaryDirectory.resolve("ready");

        assertFalse(SmokeReadiness.publish(null, temporaryPath, readinessPath));
        assertFalse(Files.exists(temporaryPath));
        assertFalse(Files.exists(readinessPath));
    }

    @Test
    void validNonceReplacesSentinelWithExactLine() throws IOException {
        Path temporaryPath = temporaryDirectory.resolve("ready.tmp");
        Path readinessPath = temporaryDirectory.resolve("ready");
        Files.writeString(readinessPath, "stale\n");

        assertTrue(SmokeReadiness.publish("phase0-fabric.test_1", temporaryPath, readinessPath));
        assertEquals("phase0-fabric.test_1" + System.lineSeparator(), Files.readString(readinessPath));
        assertFalse(Files.exists(temporaryPath));
    }

    @Test
    void invalidNonceFailsBeforeWriting() {
        Path temporaryPath = temporaryDirectory.resolve("ready.tmp");
        Path readinessPath = temporaryDirectory.resolve("ready");

        assertThrows(
                IllegalStateException.class,
                () -> SmokeReadiness.publish("invalid nonce", temporaryPath, readinessPath));
        assertFalse(Files.exists(temporaryPath));
        assertFalse(Files.exists(readinessPath));
    }
}
