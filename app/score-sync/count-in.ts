let context: AudioContext | undefined;
let buffers: AudioBuffer[] = [];
let preparing: Promise<void> | undefined;
let activeSources: AudioBufferSourceNode[] = [];

export const countInSecondsOrDefault = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4 ? value : 4;

export function prepareCountIn(): Promise<void> {
  return preparing ??= (async () => {
    context ??= new window.AudioContext();
    const audio = context;
    buffers = await Promise.all(["one", "two", "three", "four"].map(async word => {
      const response = await fetch(`/audio/count-in/${word}.wav`);
      if (!response.ok) throw new Error("Count-in audio unavailable");
      return audio.decodeAudioData(await response.arrayBuffer());
    }));
  })().catch(() => { preparing = undefined; });
}

const stopSources = (sources: AudioBufferSourceNode[]) => {
  for (const source of sources) {
    try { source.stop(); source.disconnect(); } catch { /* Already stopped. */ }
  }
};

export function stopCountIn() {
  stopSources(activeSources);
  activeSources = [];
}

// Schedule speech on the audio clock; JS timer delays must not change the cadence.
export function startCountIn(seconds: number): () => number {
  stopCountIn();
  const startedAt = performance.now();
  const fallback = () => performance.now() - startedAt;
  if (!seconds) return fallback;
  void prepareCountIn();
  const audio = context;
  if (!audio || buffers.length !== 4) return fallback;
  const sources: AudioBufferSourceNode[] = [];
  let unavailable = false;
  try {
    // Called directly from the measure click to unlock audio on mobile browsers.
    void audio.resume().catch(() => { unavailable = true; stopSources(sources); });
    const start = audio.currentTime + .05;
    activeSources = sources;
    for (let beat = 0; beat < countInSecondsOrDefault(seconds); beat++) {
      const source = audio.createBufferSource();
      sources.push(source);
      source.buffer = buffers[beat];
      source.connect(audio.destination);
      source.start(start + beat);
    }
    return () => {
      // Some browsers leave resume pending instead of rejecting blocked audio.
      if (!unavailable && audio.state !== "running" && fallback() > 500) {
        unavailable = true;
        stopSources(sources);
      }
      return unavailable ? fallback() : Math.max(0, (audio.currentTime - start) * 1000);
    };
  } catch {
    stopSources(sources);
    return fallback;
  }
}
