package com.capstone.momentbackend.project.controller;
import com.capstone.momentbackend.project.dto.*;
import com.capstone.momentbackend.project.service.ProjectService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;
import java.util.List;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {
 private final ProjectService projectService;
 public ProjectController(ProjectService projectService) { this.projectService=projectService; }
 @PostMapping @ResponseStatus(HttpStatus.CREATED)
 public ProjectResponse createProject(@Valid @RequestBody CreateProjectRequest request) { return projectService.createProject(request); }
 @GetMapping("/{projectId}")
 public ProjectResponse getProject(@PathVariable("projectId") UUID projectId) { return projectService.getProject(projectId); }
    @GetMapping
    public List<ProjectResponse> getAllProjects() {
        return projectService.getAllProjects();
    }
}
