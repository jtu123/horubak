package com.capstone.momentbackend.auth.jwt;

import com.capstone.momentbackend.auth.entity.User;
import com.capstone.momentbackend.auth.repository.UserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenProvider jwtTokenProvider;
    private final UserRepository userRepository;

    public JwtAuthenticationFilter(
            JwtTokenProvider jwtTokenProvider,
            UserRepository userRepository
    ) {
        this.jwtTokenProvider = jwtTokenProvider;
        this.userRepository = userRepository;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {

        String authorization =
                request.getHeader("Authorization");

        if (authorization != null
                && authorization.startsWith("Bearer ")) {

            String token = authorization.substring(7);

            if (jwtTokenProvider.validateToken(token)) {

                UUID userId = jwtTokenProvider.getUserId(token);

                User user = userRepository.findById(userId)
                        .orElse(null);

                if (user != null) {

                    UsernamePasswordAuthenticationToken authentication =
                            new UsernamePasswordAuthenticationToken(
                                    user.getId().toString(),
                                    null,
                                    AuthorityUtils.NO_AUTHORITIES
                            );

                    SecurityContextHolder.getContext()
                            .setAuthentication(authentication);
                }
            }
        }

        filterChain.doFilter(request, response);
    }
}
