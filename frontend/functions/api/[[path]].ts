interface AuthBinding {
  fetch(request: Request): Promise<Response>;
}

interface PagesRequest {
  request: Request;
  env: { HORUBAK_AUTH?: AuthBinding };
}

export function onRequest({ request, env }: PagesRequest) {
  if (env.HORUBAK_AUTH) return env.HORUBAK_AUTH.fetch(request);
  return Response.json({ code: 'AUTH_UNAVAILABLE', message: '인증 서버에 연결하지 못했어요.' }, {
    status: 503, headers: { 'Cache-Control': 'no-store' },
  });
}
