package com.capstone.momentbackend.audio;

import com.capstone.momentbackend.transcript.dto.SttResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

import java.nio.file.Files;
import java.nio.file.Path;

@Service
public class AiSttService {

    private final RestClient restClient;

    public AiSttService(
            @Value("${app.ai.url:http://127.0.0.1:8000}")
            String aiServerUrl
    ) {
        SimpleClientHttpRequestFactory factory =
                new SimpleClientHttpRequestFactory();

        factory.setConnectTimeout(5000);
        factory.setReadTimeout(300000);

        this.restClient = RestClient.builder()
                .baseUrl(aiServerUrl)
                .requestFactory(factory)
                .build();
    }

    // 기존 API에서 사용: JSON을 문자열로 받기
    public String transcribe(Path audioPath) {

        String response = requestTranscription(
                audioPath,
                String.class
        );

        if (response.isBlank()) {
            throw new IllegalStateException(
                    "AI 서버에서 빈 응답을 반환했습니다."
            );
        }

        return response;
    }

    // DB 저장 기능에서 사용: JSON을 Java 객체로 받기
    public SttResponse transcribeResult(Path audioPath) {

        SttResponse response = requestTranscription(
                audioPath,
                SttResponse.class
        );

        if (response.language() == null
                || response.language().isBlank()
                || response.segments() == null) {
            throw new IllegalStateException(
                    "AI 서버의 STT 응답 형식이 올바르지 않습니다."
            );
        }

        return response;
    }

    // 두 메서드에서 공통으로 사용하는 FastAPI 호출
    private <T> T requestTranscription(
            Path audioPath,
            Class<T> responseType
    ) {
        if (!Files.isRegularFile(audioPath)) {
            throw new IllegalArgumentException(
                    "WAV 파일이 존재하지 않습니다: " + audioPath
            );
        }

        MultiValueMap<String, Object> body =
                new LinkedMultiValueMap<>();

        body.add("file", new FileSystemResource(audioPath));

        T response = restClient.post()
                .uri("/api/stt/transcribe")
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(body)
                .retrieve()
                .body(responseType);

        if (response == null) {
            throw new IllegalStateException(
                    "AI 서버에서 빈 응답을 반환했습니다."
            );
        }

        return response;
    }
}