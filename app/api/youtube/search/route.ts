export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() || "";
  const fail = (error: string, status: number) => Response.json({ error }, { status });
  if (!q || q.length > 120) return fail("검색어를 1~120자로 입력해 주세요.", 400);
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return fail("YouTube 검색 설정이 아직 준비되지 않았어요. 지금은 영상 링크로 연결할 수 있어요.", 503);
  const params = new URLSearchParams({ key, q, part: "snippet", type: "video", videoEmbeddable: "true", videoSyndicated: "true", maxResults: "5", relevanceLanguage: "ko" });
  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: AbortSignal.timeout(8000), next: { revalidate: 300 } });
    if (!response.ok) return fail("YouTube 검색을 이용할 수 없어요. 잠시 후 다시 시도하거나 영상 링크를 넣어 주세요.", 502);
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error("Invalid search response");
    const videos = data.items.flatMap((item: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }) => {
      const id = item.id?.videoId;
      return id && /^[\w-]{11}$/.test(id) && typeof item.snippet?.title === "string"
        ? [{ id, title: item.snippet.title, channel: typeof item.snippet.channelTitle === "string" ? item.snippet.channelTitle : "" }] : [];
    });
    return Response.json({ videos });
  } catch {
    return fail("검색에 실패했어요. 잠시 후 다시 시도해 주세요.", 502);
  }
}
