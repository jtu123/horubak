package com.capstone.momentbackend.project.entity;

import com.capstone.momentbackend.video.VideoMetadataDto;
import jakarta.persistence.*;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "projects")
public class Project {

    @Id
    private UUID id;

    @Column(nullable = false, length = 100)
    private String title;

    private String genre;

    private String source;

    private String sourceName;

    private String sourceUrl;

    private Double duration;

    private String status;

    private LocalDateTime createdAt;

    @Column(name = "video_file_name")
    private String videoFileName;

    // FFprobe 영상 메타데이터
    @Column(name = "video_duration")
    private Double videoDuration;

    @Column(name = "video_width")
    private Integer videoWidth;

    @Column(name = "video_height")
    private Integer videoHeight;

    @Column(name = "video_fps")
    private Double videoFps;

    @Column(name = "video_codec")
    private String videoCodec;

    @Column(name = "audio_codec")
    private String audioCodec;

    // JPA가 사용하는 기본 생성자
    protected Project() {
    }

    // 프로젝트 생성자
    public Project(
            UUID id,
            String title,
            String genre,
            String source,
            String sourceName,
            String sourceUrl,
            Double duration
    ) {
        this.id = id;
        this.title = title;
        this.genre = genre;
        this.source = source;
        this.sourceName = sourceName;
        this.sourceUrl = sourceUrl;
        this.duration = duration;
        this.status = "CREATED";
        this.createdAt = LocalDateTime.now();
    }

    // 프로젝트 제목 변경
    public void changeTitle(String newTitle) {
        this.title = newTitle;
    }

    // 영상 메타데이터 저장
    public void updateVideoMetadata(VideoMetadataDto metadata) {
        this.videoDuration = metadata.duration();
        this.videoWidth = metadata.width();
        this.videoHeight = metadata.height();
        this.videoFps = metadata.fps();
        this.videoCodec = metadata.videoCodec();
        this.audioCodec = metadata.audioCodec();
    }

    // 기존 Getter
    public UUID getId() { return id; }
    public String getTitle() { return title; }
    public String getGenre() { return genre; }
    public String getSource() { return source; }
    public String getSourceName() { return sourceName; }
    public String getSourceUrl() { return sourceUrl; }
    public Double getDuration() { return duration; }
    public String getStatus() { return status; }
    public LocalDateTime getCreatedAt() { return createdAt; }

    public String getVideoFileName() {
        return videoFileName;
    }

    public void setVideoFileName(String videoFileName) {
        this.videoFileName = videoFileName;
    }

    // 영상 메타데이터 Getter
    public Double getVideoDuration() { return videoDuration; }
    public Integer getVideoWidth() { return videoWidth; }
    public Integer getVideoHeight() { return videoHeight; }
    public Double getVideoFps() { return videoFps; }
    public String getVideoCodec() { return videoCodec; }
    public String getAudioCodec() { return audioCodec; }
}
