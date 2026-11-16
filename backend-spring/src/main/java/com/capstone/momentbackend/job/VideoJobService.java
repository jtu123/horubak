package com.capstone.momentbackend.job;

import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.UUID;

@Service
public class VideoJobService {

    private final VideoJobRepository videoJobRepository;
    private final VideoJobWorker videoJobWorker;

    public VideoJobService(
            VideoJobRepository videoJobRepository,
            VideoJobWorker videoJobWorker
    ) {
        this.videoJobRepository = videoJobRepository;
        this.videoJobWorker = videoJobWorker;
    }

    // 영상 생성 작업 등록

    public String createJob(
            UUID projectId,
            Path inputPath,
            Path outputPath,
            double startSeconds,
            double durationSeconds,
            String editorClipId
    ) {
        VideoJob job = new VideoJob(projectId);

        videoJobRepository.save(job);

        videoJobWorker.processVideo(
                job.getId(),
                projectId,
                inputPath,
                outputPath,
                startSeconds,
                durationSeconds,
                editorClipId
        );

        return job.getId();
    }


    // 작업 ID로 상태 조회
    public VideoJob getJob(String jobId) {
        return videoJobRepository.findById(jobId)
                .orElseThrow(() ->
                        new IllegalArgumentException(
                                "작업을 찾을 수 없습니다: " + jobId
                        )
                );
    }
}
