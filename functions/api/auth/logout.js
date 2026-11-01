export async function onRequestPost({ request }) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
    }
  });
}
