
package com.capstone.momentbackend.video.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "video_clips")
public class VideoClip {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "file_name", nullable = false, length = 255)
    private String fileName;

    @Column(name = "start_seconds", nullable = false)
    private double startSeconds;

    @Column(name = "duration_seconds", nullable = false)
    private double durationSeconds;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    protected VideoClip() {
    }

    public VideoClip(
            UUID projectId,
            String fileName,
            double startSeconds,
            double durationSeconds
    ) {
        this.projectId = projectId;
        this.fileName = fileName;
        this.startSeconds = startSeconds;
        this.durationSeconds = durationSeconds;
        this.createdAt = LocalDateTime.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public String getFileName() {
        return fileName;
    }

    public double getStartSeconds() {
        return startSeconds;
    }

    public double getDurationSeconds() {
        return durationSeconds;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
