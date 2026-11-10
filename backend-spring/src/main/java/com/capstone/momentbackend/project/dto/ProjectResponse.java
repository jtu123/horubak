package com.capstone.momentbackend.project.dto;
import java.time.LocalDateTime;
import java.util.UUID;
public record ProjectResponse(UUID id, String title, String genre, String source, String sourceName, String sourceUrl, Double duration, String status, LocalDateTime createdAt) {}
