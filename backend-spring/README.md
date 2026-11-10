# Moment Backend - Spring Boot
- JDK 21 / Spring Boot 3.4.5
- IntelliJ에서 pom.xml을 Maven 프로젝트로 열고 MomentBackendApplication 실행
- 상태 확인: GET http://localhost:8080/api/health
- 프로젝트 생성: POST http://localhost:8080/api/projects
- 프로젝트 조회: GET http://localhost:8080/api/projects/{projectId}

요청 JSON 예시:
{
  "title": "첫 번째 강의 하이라이트",
  "genre": "lecture",
  "source": "url",
  "sourceName": "강의 영상",
  "sourceUrl": "https://example.com/video.mp4",
  "duration": 120.5
}

현재 프로젝트는 DB 대신 서버 메모리에 임시 저장됩니다. 서버를 재시작하면 데이터가 사라집니다.
