
package com.capstone.momentbackend.video;

import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

@Service
public class VideoClipService {

    public void extractClip(
            Path inputPath,
            Path outputPath,
            double startSeconds,
            double durationSeconds
    ) throws IOException, InterruptedException {

        // 1. 잘못된 시간 입력 검사
        if (!Double.isFinite(startSeconds)
                || !Double.isFinite(durationSeconds)
                || startSeconds < 0
                || durationSeconds <= 0) {
            throw new IllegalArgumentException(
                    "올바른 시작 시간과 영상 길이를 입력해야 합니다."
            );
        }

        // 2. FFmpeg 명령어 구성
        List<String> command = List.of(
                "ffmpeg",
                "-y",
                "-ss", String.valueOf(startSeconds),
                "-i", inputPath.toAbsolutePath().toString(),
                "-t", String.valueOf(durationSeconds),
                "-c:v", "libx264",
                "-c:a", "aac",
                outputPath.toAbsolutePath().toString()
        );

        // 3. FFmpeg 실행
        Process process = new ProcessBuilder(command)
                .redirectError(ProcessBuilder.Redirect.DISCARD)
                .start();

        // 4. 최대 2분 대기
        boolean finished = process.waitFor(
                120, TimeUnit.SECONDS
        );

        // 5. 시간 초과 검사
        if (!finished) {
            process.destroyForcibly();
            throw new IOException("FFmpeg 실행 시간 초과");
        }

        // 6. 실행 결과 확인
        if (process.exitValue() != 0) {
            throw new IOException("영상 구간 추출 실패");
        }
    }
}
