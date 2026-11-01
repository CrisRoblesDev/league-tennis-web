export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Set-Cookie": "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    }
  });
}
