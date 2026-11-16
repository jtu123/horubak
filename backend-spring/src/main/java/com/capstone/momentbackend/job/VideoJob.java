package com.capstone.momentbackend.job;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "video_jobs")
public class VideoJob {

    @Id
    @Column(length = 36)
    private String id;

    @Column(nullable = false, columnDefinition = "BINARY(16)")
    private UUID projectId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private VideoJobStatus status;

    @Column(length = 1000)
    private String outputPath;

    @Column(length = 2000)
    private String errorMessage;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    private LocalDateTime completedAt;

    protected VideoJob() {
    }

    public VideoJob(UUID  projectId) {
        this.id = UUID.randomUUID().toString();
        this.projectId = projectId;
        this.status = VideoJobStatus.PENDING;
        this.createdAt = LocalDateTime.now();
    }

    public void markProcessing() {
        this.status = VideoJobStatus.PROCESSING;
    }

    public void markCompleted(String outputPath) {
        this.status = VideoJobStatus.COMPLETED;
        this.outputPath = outputPath;
        this.completedAt = LocalDateTime.now();
    }

    public void markFailed(String errorMessage) {
        this.status = VideoJobStatus.FAILED;
        this.errorMessage = errorMessage;
        this.completedAt = LocalDateTime.now();
    }

    public String getId() {
        return id;
    }

    public UUID  getProjectId() {
        return projectId;
    }

    public VideoJobStatus getStatus() {
        return status;
    }

    public String getOutputPath() {
        return outputPath;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getCompletedAt() {
        return completedAt;
    }
}