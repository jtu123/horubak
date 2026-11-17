package com.capstone.momentbackend.transcript.repository;

import com.capstone.momentbackend.transcript.entity.TranscriptSegment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface TranscriptSegmentRepository
        extends JpaRepository<TranscriptSegment, UUID> {

    // 특정 프로젝트의 모든 문장을 문장 순서대로 조회
    List<TranscriptSegment> findByProjectIdOrderBySegmentIndexAsc(
            UUID projectId
    );

    // 특정 프로젝트의 기존 문장들을 삭제
    void deleteByProjectId(UUID projectId);
}