
package com.capstone.momentbackend.job;

import com.capstone.momentbackend.video.VideoClipService;
import com.capstone.momentbackend.video.entity.VideoClip;
import com.capstone.momentbackend.video.repository.VideoClipRepository;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

@Service
public class VideoJobWorker {

    private final VideoClipService videoClipService;
    private final VideoClipRepository videoClipRepository;
    private final VideoJobRepository videoJobRepository;

    public VideoJobWorker(
            VideoClipService videoClipService,
            VideoClipRepository videoClipRepository,
            VideoJobRepository videoJobRepository
    ) {
        this.videoClipService = videoClipService;
        this.videoClipRepository = videoClipRepository;
        this.videoJobRepository = videoJobRepository;
    }

    @Async("videoTaskExecutor")
    public void processVideo(
            String jobId,
            UUID projectId,
            Path inputPath,
            Path outputPath,
            double startSeconds,
            double durationSeconds,
            String editorClipId
    ) {
        VideoJob job = videoJobRepository.findById(jobId)
                .orElseThrow(() ->
                        new IllegalArgumentException(
                                "작업을 찾을 수 없습니다: " + jobId
                        )
                );

        try {
            // 1. 작업 시작
            job.markProcessing();
            videoJobRepository.save(job);

            // 2. FFmpeg로 9:16 영상 생성
            videoClipService.extractClip(
                    inputPath,
                    outputPath,
                    startSeconds,
                    durationSeconds
            );

            // 3. 생성된 영상 정보를 MySQL에 저장
            VideoClip newClip = new VideoClip(
                    projectId,
                    outputPath.getFileName().toString(),
                    startSeconds,
                    durationSeconds
            );

            newClip.setEditorClipId(editorClipId);
            videoClipRepository.save(newClip);

            // 4. 작업 완료
            job.markCompleted(outputPath.toString());
            videoJobRepository.save(job);

        } catch (Exception e) {
            // 실패한 출력 파일 정리
            try {
                Files.deleteIfExists(outputPath);
            } catch (Exception cleanupError) {
                e.addSuppressed(cleanupError);
            }

            // 작업 실패 기록
            job.markFailed(e.getMessage());
            videoJobRepository.save(job);
        }
    }
}
