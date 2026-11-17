from openai import OpenAI

# OPENAI_API_KEY 환경변수를 자동으로 읽음
client = OpenAI(
    timeout=60.0,
    max_retries=0
)

# 짧은 연결 확인 요청
response = client.responses.create(
    model="gpt-5-mini",
    input="'API 연결 성공'이라는 문구만 출력해 주세요.",
    reasoning={"effort": "minimal"},
    max_output_tokens=256
)

print("응답 상태:", response.status)
print("모델 응답:", response.output_text)

if response.status != "completed":
    print("미완료 사유:", response.incomplete_details)