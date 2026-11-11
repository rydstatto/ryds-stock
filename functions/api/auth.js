import { errorResponse, json, requireAuth } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  try {
    const role = requireAuth(request, env);
    return json({ authenticated: true, role });
  } catch (error) {
    return errorResponse(error);
  }
}
