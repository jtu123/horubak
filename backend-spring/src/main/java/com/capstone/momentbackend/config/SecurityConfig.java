package com.capstone.momentbackend.config;

import com.capstone.momentbackend.auth.jwt.JwtAuthenticationFilter;
import com.capstone.momentbackend.auth.jwt.JwtTokenProvider;
import com.capstone.momentbackend.auth.repository.UserRepository;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            JwtTokenProvider jwtTokenProvider,
            UserRepository userRepository
    ) throws Exception {

        JwtAuthenticationFilter jwtFilter =
                new JwtAuthenticationFilter(
                        jwtTokenProvider,
                        userRepository
                );

        http
                // JWT 기반 인증: 세션 사용하지 않음
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
                )

                // JWT 헤더 인증 방식
                .csrf(AbstractHttpConfigurer::disable)

                // 기본 로그인 기능 비활성화
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)

                // API 접근 권한 설정
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()

                        // 회원가입 및 로그인은 공개
                        .requestMatchers("/api/auth/**").permitAll()

                        // 서버 상태 확인
                        .requestMatchers("/api/health").permitAll()

                        // 나머지 API는 로그인 필수
                        .anyRequest().authenticated()
                )

                // 인증되지 않은 요청은 401 반환
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(
                                (request, response, authException) -> {
                                    response.sendError(
                                            HttpServletResponse.SC_UNAUTHORIZED,
                                            "인증이 필요합니다."
                                    );
                                }
                        )
                )

                // JWT 인증 필터 등록
                .addFilterBefore(
                        jwtFilter,
                        UsernamePasswordAuthenticationFilter.class
                );

        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
