package com.capstone.momentbackend.transcript.entity;

import jakarta.persistence.*;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "transcript_segments")
public class TranscriptSegment {

    // 문장 데이터 자체의 고유 ID
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    // 이 문장이 속한 프로젝트 ID
    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    // 영상 내 문장 순서: 0, 1, 2, ...
    @Column(name = "segment_index", nullable = false)
    private int segmentIndex;

    // 문장 시작 시간(초)
    @Column(name = "start_seconds", nullable = false)
    private double startSeconds;

    // 문장 종료 시간(초)
    @Column(name = "end_seconds", nullable = false)
    private double endSeconds;

    // 인식된 문장 내용
    @Column(name = "text", nullable = false, columnDefinition = "TEXT")
    private String text;

    // 인식 언어: ko, en 등
    @Column(name = "language", nullable = false, length = 20)
    private String language;

    // DB 저장용 객체가 생성된 시간
    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    // JPA가 DB 조회 결과로 객체를 만들 때 사용
    protected TranscriptSegment() {
    }

    // STT 결과를 저장할 객체를 만들 때 사용
    public TranscriptSegment(
            UUID projectId,
            int segmentIndex,
            double startSeconds,
            double endSeconds,
            String text,
            String language
    ) {
        this.projectId = projectId;
        this.segmentIndex = segmentIndex;
        this.startSeconds = startSeconds;
        this.endSeconds = endSeconds;
        this.text = text;
        this.language = language;
        this.createdAt = LocalDateTime.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public int getSegmentIndex() {
        return segmentIndex;
    }

    public double getStartSeconds() {
        return startSeconds;
    }

    public double getEndSeconds() {
        return endSeconds;
    }

    public String getText() {
        return text;
    }

    public String getLanguage() {
        return language;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}