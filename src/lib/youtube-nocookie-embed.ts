/** Převede YouTube URL na embed URL (privacy-enhanced). */
export function toYoutubeNocookieEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    }
  } catch {
    /* ignore */
  }
  return null;
}
