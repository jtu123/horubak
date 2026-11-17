package com.capstone.momentbackend.transcript.dto;

import java.util.List;

public record SttResponse(
        String language,
        List<Segment> segments
) {

    public record Segment(
            double start,
            double end,
            String text
    ) {
    }
}