package dev.mcdev.fixture.fabricempty;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;

public final class SmokeReadiness {
    private SmokeReadiness() {}

    public static boolean publishFromEnvironment(
            String environmentName,
            Path temporaryPath,
            Path readinessPath) {
        return publish(System.getenv(environmentName), temporaryPath, readinessPath);
    }

    static boolean publish(String nonce, Path temporaryPath, Path readinessPath) {
        if (nonce == null) {
            return false;
        }
        if (!nonce.matches("[A-Za-z0-9._-]{1,128}")) {
            throw new IllegalStateException("Invalid Fabric smoke readiness nonce");
        }

        try {
            Files.writeString(
                    temporaryPath,
                    nonce + System.lineSeparator(),
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE);
            try {
                Files.move(
                        temporaryPath,
                        readinessPath,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(
                        temporaryPath,
                        readinessPath,
                        StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Could not publish Fabric smoke readiness", exception);
        }
        return true;
    }
}
