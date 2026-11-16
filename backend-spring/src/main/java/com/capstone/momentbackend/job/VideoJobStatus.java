package com.capstone.momentbackend.job;

public enum VideoJobStatus {
    PENDING,     // 작업 대기
    PROCESSING,  // 영상 생성 중
    COMPLETED,   // 생성 완료
    FAILED       // 생성 실패
}
