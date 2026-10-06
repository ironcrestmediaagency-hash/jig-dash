import { handleAdmin, scheduledReddit } from "./functions/api/admin.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/admin")) return handleAdmin(request, env);
    if (url.pathname === "/") return Response.redirect(url.origin + "/dashboard", 302);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledReddit(env));
  }
};
