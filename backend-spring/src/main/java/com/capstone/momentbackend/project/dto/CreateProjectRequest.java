package com.capstone.momentbackend.project.dto;
import jakarta.validation.constraints.*;
public record CreateProjectRequest(
 @NotBlank(message="프로젝트 제목은 필수입니다.") @Size(max=100) String title,
 @NotBlank(message="장르(genre)는 필수입니다.") String genre,
 @NotBlank(message="입력 유형(source)은 필수입니다.") @Pattern(regexp="file|url", message="source는 file 또는 url이어야 합니다.") String source,
 String sourceName, String sourceUrl, Double duration
) {}
