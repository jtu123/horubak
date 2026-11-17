package com.capstone.momentbackend.transcript.service;

import com.capstone.momentbackend.project.repository.ProjectRepository;
import com.capstone.momentbackend.transcript.dto.SttResponse;
import com.capstone.momentbackend.transcript.entity.TranscriptSegment;
import com.capstone.momentbackend.transcript.repository.TranscriptSegmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class TranscriptService {

    private final ProjectRepository projectRepository;
    private final TranscriptSegmentRepository transcriptSegmentRepository;

    public TranscriptService(
            ProjectRepository projectRepository,
            TranscriptSegmentRepository transcriptSegmentRepository
    ) {
        this.projectRepository = projectRepository;
        this.transcriptSegmentRepository = transcriptSegmentRepository;
    }

    // STT 분석 결과를 저장하고 저장한 문장 수를 반환
    @Transactional
    public int saveResult(UUID projectId, SttResponse response) {

        // 1. 프로젝트 존재 여부 확인
        if (projectId == null
                || !projectRepository.existsById(projectId)) {
            throw new IllegalArgumentException(
                    "프로젝트가 존재하지 않습니다."
            );
        }

        // 2. 응답의 필수 정보 확인
        if (response == null
                || response.language() == null
                || response.language().isBlank()
                || response.language().length() > 20
                || response.segments() == null) {
            throw new IllegalArgumentException(
                    "STT 응답 형식이 올바르지 않습니다."
            );
        }

        // 3. 저장할 Entity 목록 생성
        List<TranscriptSegment> entities = new ArrayList<>();

        for (int i = 0; i < response.segments().size(); i++) {

            SttResponse.Segment segment =
                    response.segments().get(i);

            // 시간과 문장 내용 검증
            if (segment == null
                    || !Double.isFinite(segment.start())
                    || !Double.isFinite(segment.end())
                    || segment.start() < 0
                    || segment.end() <= segment.start()
                    || segment.text() == null
                    || segment.text().isBlank()) {
                throw new IllegalArgumentException(
                        "STT 문장 데이터가 올바르지 않습니다. 순서: " + i
                );
            }

            TranscriptSegment entity = new TranscriptSegment(
                    projectId,
                    i,
                    segment.start(),
                    segment.end(),
                    segment.text(),
                    response.language()
            );

            entities.add(entity);
        }

        // 4. 기존 분석 결과 삭제
        transcriptSegmentRepository.deleteByProjectId(projectId);

        // 5. 새 분석 결과 저장
        transcriptSegmentRepository.saveAll(entities);

        // 6. 저장한 문장 수 반환
        return entities.size();
    }
    // 프로젝트의 STT 문장을 순서대로 조회
    @Transactional(readOnly = true)
    public List<TranscriptSegment> getSegments(UUID projectId) {

        if (projectId == null
                || !projectRepository.existsById(projectId)) {
            throw new IllegalArgumentException(
                    "프로젝트가 존재하지 않습니다."
            );
        }

        return transcriptSegmentRepository
                .findByProjectIdOrderBySegmentIndexAsc(projectId);
    }
}