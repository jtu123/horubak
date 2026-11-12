const API_BASE_URL = 'http://localhost:8080';

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {

  // 로그인할 때 저장한 JWT 가져오기
  const token = sessionStorage.getItem('moment.accessToken');

  // 기존 헤더 유지
  const headers = new Headers(options.headers);

  // JWT가 있으면 Authorization 헤더 추가
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Spring Boot API 요청
  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });
}
