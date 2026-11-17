package com.capstone.momentbackend.audio;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/audio")
public class AudioController {

    private final AudioExtractionService audioExtractionService;
    private final AiSttService aiSttService;

    @Value("${app.upload.dir:uploads}")
    private String uploadDir;

    public AudioController(
            AudioExtractionService audioExtractionService,
            AiSttService aiSttService
    ) {
        this.audioExtractionService = audioExtractionService;
        this.aiSttService = aiSttService;
    }

    // 기존 MP4 → WAV 추출 API
    @PostMapping("/extract")
    public ResponseEntity<?> extractAudio(
            @RequestParam String fileName
    ) throws Exception {

        if (!isValidFileName(fileName)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "올바르지 않은 파일명입니다."));
        }

        Path inputPath = Path.of(uploadDir)
                .toAbsolutePath()
                .normalize()
                .resolve(fileName);

        if (!Files.isRegularFile(inputPath)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "원본 영상이 없습니다."));
        }

        String audioFileName = UUID.randomUUID() + ".wav";

        Path outputPath = Path.of(uploadDir)
                .toAbsolutePath()
                .normalize()
                .resolve("audio")
                .resolve(audioFileName);

        audioExtractionService.extractAudio(inputPath, outputPath);

        return ResponseEntity.ok(Map.of(
                "message", "음성 추출 성공",
                "audioFileName", audioFileName
        ));
    }

    // 새 API: WAV → FastAPI Whisper STT
    @PostMapping(
            value = "/transcribe",
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    public ResponseEntity<?> transcribeAudio(
            @RequestParam String audioFileName
    ) {

        if (!isValidFileName(audioFileName)
                || !audioFileName.toLowerCase().endsWith(".wav")) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "올바르지 않은 WAV 파일명입니다."));
        }

        Path audioPath = Path.of(uploadDir)
                .toAbsolutePath()
                .normalize()
                .resolve("audio")
                .resolve(audioFileName);

        if (!Files.isRegularFile(audioPath)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "WAV 파일이 없습니다."));
        }

        // FastAPI 호출 후 STT JSON 결과 반환
        String result = aiSttService.transcribe(audioPath);

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(result);
    }

    private boolean isValidFileName(String fileName) {
        return fileName != null
                && fileName.matches("[a-zA-Z0-9._-]+")
                && !fileName.equals(".")
                && !fileName.equals("..");
    }

    // MP4 → WAV 추출 → Whisper STT 자동 실행
    @PostMapping(
            value = "/analyze",
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    public ResponseEntity<?> analyzeVideo(
            @RequestParam String fileName
    ) throws Exception {

        // 1. 파일명 검증
        if (!isValidFileName(fileName)
                || !fileName.toLowerCase().endsWith(".mp4")) {
            return ResponseEntity.badRequest()
                    .body(Map.of(
                            "message",
                            "올바르지 않은 MP4 파일명입니다."
                    ));
        }

        // 2. 원본 영상 경로
        Path inputPath = Path.of(uploadDir)
                .toAbsolutePath()
                .normalize()
                .resolve(fileName);

        if (!Files.isRegularFile(inputPath)) {
            return ResponseEntity.badRequest()
                    .body(Map.of(
                            "message",
                            "원본 영상이 없습니다."
                    ));
        }

        // 3. WAV 파일 경로 생성
        String audioFileName =
                UUID.randomUUID() + ".wav";

        Path audioPath = Path.of(uploadDir)
                .toAbsolutePath()
                .normalize()
                .resolve("audio")
                .resolve(audioFileName);

        // 4. MP4 → WAV
        audioExtractionService.extractAudio(
                inputPath,
                audioPath
        );

        // 5. WAV → FastAPI → Whisper
        String sttResult =
                aiSttService.transcribe(audioPath);

        // 6. STT 결과 반환
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(sttResult);
    }

}
