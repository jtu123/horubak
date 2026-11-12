package com.capstone.momentbackend.auth.controller;

import com.capstone.momentbackend.auth.entity.User;
import com.capstone.momentbackend.auth.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.capstone.momentbackend.auth.jwt.JwtTokenProvider;


import java.time.LocalDateTime;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final JwtTokenProvider jwtTokenProvider;

    public AuthController(AuthService authService, JwtTokenProvider jwtTokenProvider) {
        this.authService = authService;
        this.jwtTokenProvider = jwtTokenProvider;
    }

    // 회원가입 요청 데이터
    public record SignupRequest(
            String email,
            String password,
            String nickname
    ) {}

    // 회원가입 응답 데이터
    public record SignupResponse(
            UUID id,
            String email,
            String nickname,
            LocalDateTime createdAt
    ) {}

    @PostMapping("/signup")
    public ResponseEntity<?> signup(
            @RequestBody SignupRequest request
    ) {
        try {
            User user = authService.signup(
                    request.email(),
                    request.password(),
                    request.nickname()
            );

            SignupResponse response = new SignupResponse(
                    user.getId(),
                    user.getEmail(),
                    user.getNickname(),
                    user.getCreatedAt()
            );

            return ResponseEntity
                    .status(HttpStatus.CREATED)
                    .body(response);

        } catch (IllegalArgumentException e) {
            return ResponseEntity
                    .badRequest()
                    .body(new ErrorResponse(e.getMessage()));
        }
    }

    public record ErrorResponse(String message) {}

    // 로그인 요청 데이터
    public record LoginRequest(
            String email,
            String password
    ) {}

    // 로그인 응답 데이터
    public record LoginResponse(
            UUID id,
            String email,
            String nickname,
            String accessToken,
            String tokenType
    ) {}


    @PostMapping("/login")
    public ResponseEntity<?> login(
            @RequestBody LoginRequest request
    ) {
        try {
            // 1. 이메일과 비밀번호 검증
            User user = authService.login(
                    request.email(),
                    request.password()
            );

            // 2. JWT 토큰 생성
            String accessToken =
                    jwtTokenProvider.generateToken(user.getId());

            // 3. 로그인 결과 반환
            LoginResponse response = new LoginResponse(
                    user.getId(),
                    user.getEmail(),
                    user.getNickname(),
                    accessToken,
                    "Bearer"
            );

            return ResponseEntity.ok(response);

        } catch (IllegalArgumentException e) {
            return ResponseEntity
                    .status(HttpStatus.UNAUTHORIZED)
                    .body(new ErrorResponse(e.getMessage()));
        }
    }


}
