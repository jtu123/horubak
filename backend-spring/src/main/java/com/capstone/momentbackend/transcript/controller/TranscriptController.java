package com.capstone.momentbackend.transcript.controller;

import com.capstone.momentbackend.audio.AiSttService;
import com.capstone.momentbackend.audio.AudioExtractionService;
import com.capstone.momentbackend.project.service.ProjectService;
import com.capstone.momentbackend.transcript.dto.SttResponse;
import com.capstone.momentbackend.transcript.entity.TranscriptSegment;
import com.capstone.momentbackend.transcript.service.TranscriptService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/transcripts")
public class TranscriptController {

    private final ProjectService projectService;
    private final AudioExtractionService audioExtractionService;
    private final AiSttService aiSttService;
    private final TranscriptService transcriptService;

    @Value("${app.upload.dir:uploads}")
    private String uploadDir;

    public TranscriptController(
            ProjectService projectService,
            AudioExtractionService audioExtractionService,
            AiSttService aiSttService,
            TranscriptService transcriptService
    ) {
        this.projectService = projectService;
        this.audioExtractionService = audioExtractionService;
        this.aiSttService = aiSttService;
        this.transcriptService = transcriptService;
    }

    @PostMapping("/projects/{projectId}/analyze")
    public ResponseEntity<Map<String, Object>> analyzeProject(
            @PathVariable("projectId") UUID projectId
    ) throws Exception {

        // 1. 프로젝트에 등록된 원본 영상 파일명 조회
        String fileName = projectService.getVideoFileName(projectId);

        // 2. 원본 영상 경로 생성 및 검사
        Path basePath = Path.of(uploadDir)
                .toAbsolutePath()
                .normalize();

        Path videoPath = basePath.resolve(fileName).normalize();

        if (!videoPath.startsWith(basePath)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "올바르지 않은 영상 경로입니다."
            );
        }

        if (!Files.isRegularFile(videoPath)) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "원본 영상 파일이 없습니다."
            );
        }

        // 3. 이번 분석에 사용할 임시 WAV 파일 생성
        Path audioDir = basePath.resolve("audio");
        Files.createDirectories(audioDir);

        Path audioPath = Files.createTempFile(
                audioDir,
                "stt-",
                ".wav"
        );

        try {
            // 4. 영상에서 음성 추출
            audioExtractionService.extractAudio(videoPath, audioPath);

            // 5. FastAPI 분석 결과를 DTO로 받기
            SttResponse result = aiSttService.transcribeResult(audioPath);

            // 6. 분석 결과를 MySQL에 저장
            int savedCount = transcriptService.saveResult(
                    projectId,
                    result
            );

            // 7. 저장 결과 반환
            return ResponseEntity.ok(Map.of(
                    "message", "STT 분석 및 저장 완료",
                    "projectId", projectId,
                    "language", result.language(),
                    "segmentCount", savedCount
            ));

        } finally {
            // 성공 또는 실패 후 이번 분석용 임시 WAV 정리
            try {
                Files.deleteIfExists(audioPath);
            } catch (java.io.IOException cleanupError) {
                // 정리 실패가 분석 결과나 원래 오류를 덮지 않도록 기록
                org.slf4j.LoggerFactory
                        .getLogger(TranscriptController.class)
                        .warn("임시 WAV 파일 삭제 실패: {}", audioPath, cleanupError);
            }
        }
    }
    // DB에 저장된 STT 문장 조회
    @GetMapping("/projects/{projectId}")
    public ResponseEntity<List<TranscriptSegment>> getSegments(
            @PathVariable("projectId") UUID projectId
    ) {
        // 프로젝트가 없으면 기존 ProjectService에서 404 반환
        projectService.getProject(projectId);

        List<TranscriptSegment> segments =
                transcriptService.getSegments(projectId);

        return ResponseEntity.ok(segments);
    }
    @Value("${app.ai.url:http://127.0.0.1:8000}")
    private String aiServerUrl;

    @PostMapping("/projects/{projectId}/highlights")
    public ResponseEntity<String> recommendHighlights(
            @PathVariable("projectId") UUID projectId,
            @RequestParam("genre") String genre
    ) {
        if (!List.of("lecture", "speech", "podcast").contains(genre)) {
            return ResponseEntity.badRequest()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"detail\":\"지원하지 않는 장르입니다.\"}");
        }

        projectService.getProject(projectId);
        List<TranscriptSegment> segments =
                transcriptService.getSegments(projectId);

        if (segments.isEmpty()) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"detail\":\"먼저 영상의 자막을 분석해 저장하세요.\"}");
        }

        var subtitles = segments.stream()
                .map(segment -> Map.of(
                        "segmentIndex", segment.getSegmentIndex(),
                        "startSeconds", segment.getStartSeconds(),
                        "endSeconds", segment.getEndSeconds(),
                        "text", segment.getText()
                ))
                .toList();

        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(75000);

        RestClient client = RestClient.builder()
                .baseUrl(aiServerUrl)
                .requestFactory(factory)
                .build();

        try {
            return client.post()
                    .uri("/api/highlights/recommend")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("genre", genre, "segments", subtitles))
                    .retrieve()
                    .toEntity(String.class);
        } catch (RestClientResponseException e) {
            return ResponseEntity.status(e.getStatusCode())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(e.getResponseBodyAsString());
        } catch (RestClientException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"detail\":\"FastAPI 연결에 실패했거나 응답 시간이 초과됐습니다.\"}");
        }
    }
    @PostMapping("/projects/{projectId}/context-check")
    public ResponseEntity<String> checkContext(
            @PathVariable("projectId") UUID projectId,
            @RequestParam("start") double start,
            @RequestParam("end") double end
    ) {
        if (!Double.isFinite(start)
                || !Double.isFinite(end)
                || start < 0
                || end - start < 30
                || end - start > 60) {
            return ResponseEntity.badRequest()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"detail\":\"검토할 구간은 30~60초여야 합니다.\"}");
        }

        projectService.getProject(projectId);

        List<TranscriptSegment> segments =
                transcriptService.getSegments(projectId);

        if (segments.isEmpty()) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"detail\":\"먼저 자막 분석을 완료해 주세요.\"}");
        }

        var subtitles = segments.stream()
                .map(segment -> Map.of(
                        "segmentIndex", segment.getSegmentIndex(),
                        "startSeconds", segment.getStartSeconds(),
                        "endSeconds", segment.getEndSeconds(),
                        "text", segment.getText()
                ))
                .toList();

        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(75000);

        RestClient client = RestClient.builder()
                .baseUrl(aiServerUrl)
                .requestFactory(factory)
                .build();

        try {
            return client.post()
                    .uri("/api/highlights/context-check")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of(
                            "startSeconds", start,
                            "endSeconds", end,
                            "segments", subtitles
                    ))
                    .retrieve()
                    .toEntity(String.class);
        } catch (RestClientResponseException e) {
            return ResponseEntity.status(e.getStatusCode())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(e.getResponseBodyAsString());
        } catch (RestClientException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body("{\"detail\":\"FastAPI 연결에 실패했거나 응답 시간이 초과됐습니다.\"}");
        }
    }
}