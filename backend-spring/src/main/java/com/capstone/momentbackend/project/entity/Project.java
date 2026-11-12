
package com.capstone.momentbackend.project.entity;

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

    protected Project() {
    }

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

    public void changeTitle(String newTitle) {
        this.title = newTitle;
    }

    public UUID getId() { return id; }
    public String getTitle() { return title; }
    public String getGenre() { return genre; }
    public String getSource() { return source; }
    public String getSourceName() { return sourceName; }
    public String getSourceUrl() { return sourceUrl; }
    public Double getDuration() { return duration; }
    public String getStatus() { return status; }
    public LocalDateTime getCreatedAt() { return createdAt; }
}
