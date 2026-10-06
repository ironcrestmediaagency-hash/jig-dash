import { onRequestPost, onRequestGet } from "./functions/api/analyze.js";
import { handleAdmin, scheduledReddit } from "./functions/api/admin.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/analyze") {
      return request.method === "POST" ? onRequestPost({ request, env }) : onRequestGet();
    }
    if (url.pathname.startsWith("/api/admin")) return handleAdmin(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledReddit(env));
  }
};
