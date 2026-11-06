export function validateSourceUrl(
  sourceUrl: string
): void {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error(
      "올바른 URL 형식이 아닙니다."
    );
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    throw new Error(
      "HTTP 또는 HTTPS URL만 지원합니다."
    );
  }
}