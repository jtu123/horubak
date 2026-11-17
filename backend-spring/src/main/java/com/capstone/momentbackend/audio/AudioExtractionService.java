package com.capstone.momentbackend.audio;

import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

@Service
public class AudioExtractionService {

    public void extractAudio(
            Path inputPath,
            Path outputPath
    ) throws IOException, InterruptedException {

        // 1. 원본 영상 파일 확인
        if (!Files.isRegularFile(inputPath)) {
            throw new IOException("원본 영상 파일이 없습니다.");
        }

        // 2. WAV 저장 폴더 생성
        Path parent = outputPath.toAbsolutePath().getParent();

        if (parent != null) {
            Files.createDirectories(parent);
        }

        // 3. FFmpeg 명령어 구성
        List<String> command = List.of(
                "ffmpeg",
                "-y",
                "-i", inputPath.toAbsolutePath().toString(),
                "-vn",
                "-ac", "1",
                "-ar", "16000",
                "-c:a", "pcm_s16le",
                outputPath.toAbsolutePath().toString()
        );

        // 4. FFmpeg 실행
        Process process = new ProcessBuilder(command)
                .redirectError(ProcessBuilder.Redirect.DISCARD)
                .start();

        // 5. 최대 5분 대기
        boolean finished = process.waitFor(
                300, TimeUnit.SECONDS
        );

        // 6. 시간 초과 검사
        if (!finished) {
            process.destroyForcibly();
            throw new IOException("음성 추출 시간 초과");
        }

        // 7. FFmpeg 실행 결과 확인
        if (process.exitValue() != 0) {
            throw new IOException("음성 추출 실패");
        }

        // 8. WAV 파일 생성 확인
        if (!Files.isRegularFile(outputPath)
                || Files.size(outputPath) == 0) {
            throw new IOException("WAV 파일이 생성되지 않았습니다.");
        }
    }
}
