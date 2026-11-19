package com.capstone.momentbackend.video.repository;

import com.capstone.momentbackend.video.entity.VideoClip;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

public interface VideoClipRepository
        extends JpaRepository<VideoClip, UUID> {

    List<VideoClip> findByProjectIdOrderByCreatedAtDesc(
            UUID projectId
    );

    @Transactional
    void deleteByProjectId(UUID projectId);
}
