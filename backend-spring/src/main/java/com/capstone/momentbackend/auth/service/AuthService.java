package com.capstone.momentbackend.auth.service;

import com.capstone.momentbackend.auth.entity.User;
import com.capstone.momentbackend.auth.repository.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public AuthService(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder
    ) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public User signup(String email, String password, String nickname) {

        // 1. 입력값 검사
        if (email == null || email.isBlank()
                || password == null || password.isBlank()
                || nickname == null || nickname.isBlank()) {
            throw new IllegalArgumentException("모든 항목을 입력해 주세요.");
        }

        // 2. 이메일 정리
        String normalizedEmail =
                email.trim().toLowerCase(Locale.ROOT);

        String normalizedNickname = nickname.trim();

        // 3. 입력 길이 검사
        if (normalizedEmail.length() > 254
                || !normalizedEmail.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) {
            throw new IllegalArgumentException("올바른 이메일을 입력해 주세요.");
        }

        if (password.length() < 8 || password.length() > 64) {
            throw new IllegalArgumentException(
                    "비밀번호는 8~64자로 입력해 주세요."
            );
        }

        if (normalizedNickname.length() > 50) {
            throw new IllegalArgumentException(
                    "닉네임은 50자 이하로 입력해 주세요."
            );
        }

        // 4. 이메일 중복 검사
        if (userRepository.existsByEmail(normalizedEmail)) {
            throw new IllegalArgumentException(
                    "이미 사용 중인 이메일입니다."
            );
        }

        // 5. 비밀번호 BCrypt 해싱
        String encodedPassword =
                passwordEncoder.encode(password);

        // 6. 회원 객체 생성
        User user = new User(
                normalizedEmail,
                encodedPassword,
                normalizedNickname
        );

        // 7. MySQL에 저장
        return userRepository.save(user);
    }

    @Transactional(readOnly = true)
    public User login(String email, String password) {

        // 1. 입력값 확인
        if (email == null || email.isBlank()
                || password == null || password.isBlank()) {
            throw new IllegalArgumentException(
                    "이메일과 비밀번호를 입력해 주세요."
            );
        }

        // 2. 이메일 정규화
        String normalizedEmail =
                email.trim().toLowerCase(Locale.ROOT);

        // 3. MySQL에서 회원 검색
        User user = userRepository.findByEmail(normalizedEmail)
                .orElseThrow(() -> new IllegalArgumentException(
                        "이메일 또는 비밀번호가 올바르지 않습니다."
                ));

        // 4. BCrypt 비밀번호 검증
        if (!passwordEncoder.matches(password, user.getPassword())) {
            throw new IllegalArgumentException(
                    "이메일 또는 비밀번호가 올바르지 않습니다."
            );
        }

        // 5. 로그인 성공
        return user;
    }

}
