
package com.capstone.momentbackend.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

@Service
public class VideoMetadataService {

    private final ObjectMapper objectMapper;

    public VideoMetadataService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public VideoMetadataDto extractMetadata(Path videoPath)
            throws IOException, InterruptedException {

        List<String> command = List.of(
                "ffprobe",
                "-v", "error",
                "-show_entries",
                "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate",
                "-of", "json",
                videoPath.toAbsolutePath().toString()
        );

        Process process = new ProcessBuilder(command)
                .redirectErrorStream(true)
                .start();

        boolean finished = process.waitFor(30, TimeUnit.SECONDS);

        if (!finished) {
            process.destroyForcibly();
            throw new IOException("FFprobe 실행 시간 초과");
        }

        if (process.exitValue() != 0) {
            throw new IOException("FFprobe 실행 실패");
        }

        JsonNode root;

        try (var input = process.getInputStream()) {
            root = objectMapper.readTree(input);
        }

        // 영상 길이
        double duration = root.path("format")
                .path("duration")
                .asDouble(0);

        // 영상 스트림과 오디오 스트림 구분
        JsonNode videoStream = null;
        JsonNode audioStream = null;

        for (JsonNode stream : root.path("streams")) {

            String codecType = stream.path("codec_type").asText();

            if ("video".equals(codecType) && videoStream == null) {
                videoStream = stream;
            }

            if ("audio".equals(codecType) && audioStream == null) {
                audioStream = stream;
            }
        }

        if (videoStream == null) {
            throw new IOException("영상 스트림을 찾을 수 없습니다.");
        }

        // 해상도
        int width = videoStream.path("width").asInt(0);
        int height = videoStream.path("height").asInt(0);

        // FPS
        String frameRate = videoStream.path("avg_frame_rate")
                .asText("0/1");

        double fps = parseFrameRate(frameRate);

        // 코덱
        String videoCodec = videoStream.path("codec_name")
                .asText("unknown");

        String audioCodec = audioStream != null
                ? audioStream.path("codec_name").asText("unknown")
                : "none";

        return new VideoMetadataDto(
                duration,
                width,
                height,
                fps,
                videoCodec,
                audioCodec
        );
    }

    private double parseFrameRate(String frameRate) {

        String[] parts = frameRate.split("/");

        try {
            if (parts.length == 2) {
                double numerator = Double.parseDouble(parts[0]);
                double denominator = Double.parseDouble(parts[1]);

                if (denominator == 0) {
                    return 0;
                }

                return numerator / denominator;
            }

            return Double.parseDouble(frameRate);

        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
