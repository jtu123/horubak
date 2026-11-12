
package com.capstone.momentbackend.project.service;

import com.capstone.momentbackend.project.dto.CreateProjectRequest;
import com.capstone.momentbackend.project.dto.ProjectResponse;
import com.capstone.momentbackend.project.entity.Project;
import com.capstone.momentbackend.project.repository.ProjectRepository;
import com.capstone.momentbackend.video.VideoMetadataDto;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class ProjectService {

    private final ProjectRepository projectRepository;

    public ProjectService(ProjectRepository projectRepository) {
        this.projectRepository = projectRepository;
    }

    public ProjectResponse createProject(CreateProjectRequest request) {

        if ("url".equals(request.source())
                && (request.sourceUrl() == null
                || request.sourceUrl().isBlank())) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "source가 url이면 sourceUrl이 필요합니다."
            );
        }

        Project project = new Project(
                UUID.randomUUID(),
                request.title(),
                request.genre(),
                request.source(),
                request.sourceName(),
                request.sourceUrl(),
                request.duration()
        );

        Project savedProject = projectRepository.save(project);

        return toResponse(savedProject);
    }

    public ProjectResponse getProject(UUID projectId) {

        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "프로젝트를 찾을 수 없습니다."
                ));

        return toResponse(project);
    }

    private ProjectResponse toResponse(Project project) {

        return new ProjectResponse(
                project.getId(),
                project.getTitle(),
                project.getGenre(),
                project.getSource(),
                project.getSourceName(),
                project.getSourceUrl(),
                project.getDuration(),
                project.getStatus(),
                project.getCreatedAt()
        );
    }

    public List<ProjectResponse> getAllProjects() {

        List<Project> projects = projectRepository.findAll();

        return projects.stream()
                .map(this::toResponse)
                .collect(Collectors.toList());
    }

    public ProjectResponse updateProjectTitle(UUID projectId, String newTitle) {

        if (newTitle == null || newTitle.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "프로젝트 이름은 비워둘 수 없습니다."
            );
        }

        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "프로젝트를 찾을 수 없습니다."
                ));

        project.changeTitle(newTitle.trim());

        Project savedProject = projectRepository.save(project);

        return toResponse(savedProject);
    }

    @Transactional
    public void deleteProject(UUID projectId) {

        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "프로젝트를 찾을 수 없습니다."
                ));

        projectRepository.delete(project);
    }

    @Transactional
    public void attachVideo(UUID projectId, String fileName) {

        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "프로젝트를 찾을 수 없습니다."
                ));

        project.setVideoFileName(fileName);

        projectRepository.save(project);
    }


    @Transactional(readOnly = true)
    public String getVideoFileName(UUID projectId) {

        // 1. 프로젝트 ID로 MySQL 조회
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "프로젝트를 찾을 수 없습니다."
                ));

        // 2. 프로젝트에 연결된 영상 파일명 가져오기
        String fileName = project.getVideoFileName();

        // 3. 영상이 등록되지 않았다면 오류 반환
        if (fileName == null || fileName.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "등록된 영상이 없습니다."
            );
        }

        return fileName;
    }


    @Transactional
    public void saveVideoMetadata(
            UUID projectId,
            VideoMetadataDto metadata
    ) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "프로젝트를 찾을 수 없습니다."
                ));

        project.updateVideoMetadata(metadata);
    }


    @Transactional
    public void attachVideoWithMetadata(
            UUID projectId,
            String fileName,
            VideoMetadataDto metadata
    ) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "프로젝트를 찾을 수 없습니다."
                ));

        project.setVideoFileName(fileName);
        project.updateVideoMetadata(metadata);
    }


}
