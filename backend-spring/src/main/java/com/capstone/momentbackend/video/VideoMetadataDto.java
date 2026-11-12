
package com.capstone.momentbackend.video;

public record VideoMetadataDto(
        double duration,
        int width,
        int height,
        double fps,
        String videoCodec,
        String audioCodec
) {
}
