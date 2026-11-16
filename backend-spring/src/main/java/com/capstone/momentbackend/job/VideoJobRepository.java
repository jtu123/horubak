package com.capstone.momentbackend.job;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;
import java.util.List;

public interface VideoJobRepository
        extends JpaRepository<VideoJob, String> {

    List<VideoJob> findByProjectId(UUID projectId);
}
