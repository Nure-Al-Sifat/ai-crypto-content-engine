import "dotenv/config";
import * as postgres from "./postgres.js";
import * as supabase from "./supabase.js";

/**
 * STORAGE SELECTOR
 *
 * Both backends expose the same function surface. Pick one with STORAGE in
 * .env: "postgres" (default) or "supabase". Importing a backend is side-effect
 * free — each only connects when a function is actually called — so the unused
 * one costs nothing.
 *
 * index.js and server/webhook.js import from here, never from a backend
 * directly, so switching stores is a one-line env change.
 */
const backend = process.env.STORAGE === "supabase" ? supabase : postgres;

export const todayKey = backend.todayKey;
export const makeTopicKey = backend.makeTopicKey;
export const hasRunToday = backend.hasRunToday;
export const getRecentTopics = backend.getRecentTopics;
export const recordTopics = backend.recordTopics;
export const getTopPerformingExamples = backend.getTopPerformingExamples;
export const savePost = backend.savePost;
export const updatePostStatus = backend.updatePostStatus;
export const setChosenVariant = backend.setChosenVariant;
export const recordEngagement = backend.recordEngagement;
export const getPost = backend.getPost;
export const getPostsAwaitingMetrics = backend.getPostsAwaitingMetrics;
