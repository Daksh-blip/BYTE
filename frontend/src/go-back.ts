import { router, Href } from "expo-router";

/** Go back if there's history (e.g. not opened from a direct link), otherwise go to a sensible screen. */
export function goBack(fallback: Href = "/discover") {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
