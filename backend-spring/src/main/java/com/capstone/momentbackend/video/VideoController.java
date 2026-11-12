
package com.capstone.momentbackend.video;

import com.capstone.momentbackend.project.service.ProjectService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import com.fasterxml.jackson.databind.JsonNode;
import com.capstone.momentbackend.video.entity.VideoClip;
import com.capstone.momentbackend.video.repository.VideoClipRepository;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.*;
import java.util.Map;
import java.util.UUID;
import java.util.List;
import java.util.LinkedHashMap;


@RestController
@RequestMapping("/api/videos")
public class VideoController {


    private final ProjectService projectService;
    private final VideoMetadataService videoMetadataService;
    private final VideoClipService videoClipService;
    private final VideoClipRepository videoClipRepository;
    private final Path uploadDir =
            Paths.get("uploads").toAbsolutePath().normalize();

    public VideoController(
            ProjectService projectService,
            VideoMetadataService videoMetadataService,
            VideoClipService videoClipService,
            VideoClipRepository videoClipRepository
    ) {
        this.projectService = projectService;
        this.videoMetadataService = videoMetadataService;
        this.videoClipService = videoClipService;
        this.videoClipRepository = videoClipRepository;
    }




    @PostMapping("/upload")
    public ResponseEntity<Map<String, String>> uploadVideo(
            @RequestParam("projectId") UUID projectId,
            @RequestParam("file") MultipartFile file
    ) throws IOException, InterruptedException {

        // 1. 빈 파일 검사
        if (file.isEmpty()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "파일이 비어 있습니다."
            );
        }

        // 2. 파일 확장자 검사
        String originalName = file.getOriginalFilename();

        if (originalName == null ||
                !originalName.toLowerCase().endsWith(".mp4")) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "MP4 파일만 업로드할 수 있습니다."
            );
        }

        // 3. 업로드 폴더 생성
        Files.createDirectories(uploadDir);

        // 4. 중복되지 않는 파일명 생성
        String storedName = UUID.randomUUID() + ".mp4";
        Path target = uploadDir.resolve(storedName);

        try {
            // 5. 실제 영상 파일 저장
            try (InputStream input = file.getInputStream()) {
                Files.copy(input, target);
            }

            // 6. FFprobe로 영상 메타데이터 자동 추출
            VideoMetadataDto metadata =
                    videoMetadataService.extractMetadata(target);

            // 7. 영상 파일명과 메타데이터를 MySQL에 함께 저장
            projectService.attachVideoWithMetadata(
                    projectId,
                    storedName,
                    metadata
            );

        } catch (IOException | InterruptedException | RuntimeException e) {

            // 실패하면 새로 업로드한 파일 삭제
            try {
                Files.deleteIfExists(target);
            } catch (IOException cleanupError) {
                e.addSuppressed(cleanupError);
            }

            throw e;
        }

        // 8. 업로드 성공 응답
        return ResponseEntity.status(HttpStatus.CREATED).body(
                Map.of(
                        "projectId", projectId.toString(),
                        "fileName", storedName,
                        "originalName", originalName,
                        "message", "영상 업로드 및 메타데이터 저장 성공"
                )
        );
    }


    @GetMapping("/projects/{projectId}")
    public ResponseEntity<Resource> getVideo(
            @PathVariable("projectId") UUID projectId
    ) throws IOException {

        // 1. MySQL에서 영상 파일명 조회
        String fileName = projectService.getVideoFileName(projectId);

        // 2. 실제 파일 경로 생성
        Path videoPath = uploadDir.resolve(fileName).normalize();

        // 3. uploads 폴더 밖으로 접근하지 못하도록 검사
        if (!videoPath.startsWith(uploadDir)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "잘못된 파일 경로입니다."
            );
        }

        // 4. 영상 파일 존재 여부 확인
        if (!Files.isRegularFile(videoPath)) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "영상 파일을 찾을 수 없습니다."
            );
        }

        // 5. MP4 파일을 Resource로 변환
        Resource resource = new UrlResource(videoPath.toUri());

        // 6. 브라우저에 영상 반환
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("video/mp4"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
                .body(resource);
    }


    @GetMapping("/projects/{projectId}/metadata")
    public ResponseEntity<VideoMetadataDto> getVideoMetadata(
            @PathVariable("projectId") UUID projectId
    ) throws IOException, InterruptedException {

        // 1. 프로젝트에 연결된 영상 파일명 조회
        String fileName =
                projectService.getVideoFileName(projectId);

        // 2. 실제 영상 파일 경로 생성
        Path videoPath =
                uploadDir.resolve(fileName).normalize();

        // 3. uploads 폴더 밖의 파일 접근 차단
        if (!videoPath.startsWith(uploadDir)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "잘못된 파일 경로입니다."
            );
        }

        // 4. 영상 파일 존재 여부 확인
        if (!Files.isRegularFile(videoPath)) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "영상 파일을 찾을 수 없습니다."
            );
        }

        // 5. FFprobe를 실행해 영상 정보 추출
        VideoMetadataDto metadata =
                videoMetadataService.extractMetadata(videoPath);

        // 6. 추출된 JSON을 클라이언트에 반환
        return ResponseEntity.ok(metadata);
    }


    @PostMapping("/projects/{projectId}/metadata")
    public ResponseEntity<VideoMetadataDto> saveVideoMetadata(
            @PathVariable("projectId") UUID projectId
    ) throws IOException, InterruptedException {

        // 1. 프로젝트에 등록된 영상 파일명 조회
        String fileName = projectService.getVideoFileName(projectId);

        // 2. 실제 영상 파일 경로 생성
        Path videoPath = uploadDir.resolve(fileName).normalize();

        // 3. 잘못된 경로 접근 방지
        if (!videoPath.startsWith(uploadDir)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "잘못된 파일 경로입니다."
            );
        }

        // 4. 영상 파일 존재 여부 확인
        if (!Files.isRegularFile(videoPath)) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "영상 파일을 찾을 수 없습니다."
            );
        }

        // 5. FFprobe로 메타데이터 추출
        VideoMetadataDto metadata =
                videoMetadataService.extractMetadata(videoPath);

        // 6. MySQL에 메타데이터 저장
        projectService.saveVideoMetadata(projectId, metadata);

        // 7. 저장한 메타데이터 반환
        return ResponseEntity.ok(metadata);
    }

    @PostMapping("/projects/{projectId}/clips")
    public ResponseEntity<Map<String, String>> createClip(
            @PathVariable("projectId") UUID projectId,
            @RequestParam("start") double start,
            @RequestParam("duration") double duration
    ) throws IOException, InterruptedException {

        // 1. 시작 시간과 길이 검사
        if (!Double.isFinite(start)
                || !Double.isFinite(duration)
                || start < 0
                || duration <= 0) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "올바른 시작 시간과 길이를 입력해야 합니다."
            );
        }

        // 2. 프로젝트에 연결된 영상 파일명 조회
        String fileName = projectService.getVideoFileName(projectId);

        // 3. 원본 영상 경로 생성
        Path inputPath = uploadDir.resolve(fileName).normalize();

        if (!inputPath.startsWith(uploadDir)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "잘못된 영상 경로입니다."
            );
        }

        if (!Files.isRegularFile(inputPath)) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "원본 영상 파일을 찾을 수 없습니다."
            );
        }

        // 4. 실제 영상 길이 확인
        VideoMetadataDto metadata =
                videoMetadataService.extractMetadata(inputPath);

        if (start >= metadata.duration()
                || duration > metadata.duration() - start) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "추출 구간이 원본 영상 길이를 초과합니다."
            );
        }

        // 5. 결과 영상 저장 폴더 생성
        Path clipsDir = uploadDir.resolve("clips");
        Files.createDirectories(clipsDir);

        // 6. 결과 파일명 생성
        String clipFileName = UUID.randomUUID() + ".mp4";
        Path outputPath = clipsDir.resolve(clipFileName);

        // 7. FFmpeg로 영상 구간 추출
        try {
            videoClipService.extractClip(
                    inputPath,
                    outputPath,
                    start,
                    duration
            );
            // FFmpeg로 생성한 MP4 정보를 DB에 저장
            VideoClip savedClip = videoClipRepository.save(
                    new VideoClip(
                            projectId,
                            clipFileName,
                            start,
                            duration
                    )
            );
        } catch (IOException | InterruptedException | RuntimeException e) {
            try {
                Files.deleteIfExists(outputPath);
            } catch (IOException cleanupError) {
                e.addSuppressed(cleanupError);
            }
            throw e;
        }

        // 8. 결과 반환
        return ResponseEntity.status(HttpStatus.CREATED).body(
                Map.of(
                        "projectId", projectId.toString(),
                        "clipFileName", clipFileName,
                        "start", String.valueOf(start),
                        "duration", String.valueOf(duration),
                        "message", "영상 구간 추출 성공"
                )
        );
    }

    @GetMapping("/clips/{clipFileName}")
    public ResponseEntity<Resource> getClip(
            @PathVariable("clipFileName") String clipFileName
    ) throws IOException {

        // 1. 파일명 형식 검사
        if (!clipFileName.matches(
                "[0-9a-fA-F-]{36}\\.mp4"
        )) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "잘못된 클립 파일명입니다."
            );
        }

        // 2. 클립 저장 폴더 경로
        Path clipsDir = uploadDir.resolve("clips").normalize();

        // 3. 요청한 클립 파일 경로
        Path clipPath = clipsDir.resolve(clipFileName).normalize();

        // 4. clips 폴더 밖 접근 차단
        if (!clipPath.startsWith(clipsDir)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "잘못된 파일 경로입니다."
            );
        }

        // 5. 파일 존재 여부 검사
        if (!Files.isRegularFile(clipPath)) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "클립 파일을 찾을 수 없습니다."
            );
        }

        // 6. MP4 파일을 Resource로 변환
        Resource resource = new UrlResource(clipPath.toUri());

        // 7. 브라우저에 영상 반환
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("video/mp4"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
                .body(resource);
    }


    @GetMapping("/projects/{projectId}/clips")
    public ResponseEntity<?> getProjectClips(
            @PathVariable("projectId") UUID projectId
    ) {
        List<VideoClip> clips =
                videoClipRepository.findByProjectIdOrderByCreatedAtDesc(projectId);

        List<Map<String, Object>> result = clips.stream()
                .map(clip -> {
                    Map<String, Object> item = new LinkedHashMap<>();

                    item.put("id", clip.getId());
                    item.put("projectId", clip.getProjectId());
                    item.put("clipFileName", clip.getFileName());
                    item.put("start", clip.getStartSeconds());
                    item.put("duration", clip.getDurationSeconds());
                    item.put("createdAt", clip.getCreatedAt());

                    return item;
                })
                .toList();

        return ResponseEntity.ok(result);
    }


}
