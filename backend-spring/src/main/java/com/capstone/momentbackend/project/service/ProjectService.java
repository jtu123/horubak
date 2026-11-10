
package com.capstone.momentbackend.project.service;

import com.capstone.momentbackend.project.dto.CreateProjectRequest;
import com.capstone.momentbackend.project.dto.ProjectResponse;
import com.capstone.momentbackend.project.entity.Project;
import com.capstone.momentbackend.project.repository.ProjectRepository;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

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
}
