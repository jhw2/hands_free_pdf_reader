"use client";

import { useEffect, useRef, useState } from "react";
import type { Camera as MediaPipeCamera } from "@mediapipe/camera_utils";
import type { FaceMesh as MediaPipeFaceMesh, NormalizedLandmark, Results } from "@mediapipe/face_mesh";

const READER_DB_NAME = "motion-pdf-reader";
const READER_STORE_NAME = "reader-state";
const SESSION_STATE_KEY = "session-state";
const SAVED_SCORES_KEY = "saved-scores";
const MOUTH_HOLD_DURATION_STORAGE_KEY = "mouth-hold-duration-ms";
const GESTURE_FEEDBACK_DURATION_MS = 1000;
const TOUCH_SWIPE_MIN_DISTANCE_PX = 50;
const MOUTH_HOLD_DURATION_OPTIONS_MS = [300, 400, 500, 700, 1000];
const PAGE_TURN_COOLDOWN_MS = 1200;
const MOUTH_RATIO_SMOOTHING_ALPHA = 0.55;
const MOUTH_OPEN_RATIO_THRESHOLD = 0.36;
const MOUTH_CLOSE_RATIO_THRESHOLD = 0.18;
const MOUTH_HOLD_DURATION_MS = 500;
const MOUTH_MIN_OPEN_MS = 40;
const MOUTH_DOUBLE_TAP_WINDOW_MS = 600;
const MOUTH_STABLE_FRAME_TARGET = 2;

type SavedScore = {
  id: string;
  name: string;
  pdfBlob: Blob;
  currentPage: number;
  updatedAt: number;
};

type SessionState = {
  pdfBlob: Blob | null;
  fileName: string | null;
  currentPage: number;
  savedScoreId: string | null;
};

type MouthPhase = "idle" | "open" | "first-closed" | "waiting-close";

type MouthDetectionState = {
  phase: MouthPhase;
  startedAt: number | null;
  closedAt: number | null;
  stableFrames: number;
};

declare global {
  interface Window {
    pdfjsLib: any;
  }
}

const openReaderDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(READER_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(READER_STORE_NAME)) {
        db.createObjectStore(READER_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readReaderValue = async <T,>(key: string): Promise<T | null> => {
  const db = await openReaderDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(READER_STORE_NAME, "readonly");
    const store = transaction.objectStore(READER_STORE_NAME);
    const request = store.get(key);

    transaction.oncomplete = () => {
      resolve((request.result as T | undefined) ?? null);
      db.close();
    };

    transaction.onerror = () => {
      reject(transaction.error);
      db.close();
    };
  });
};

const writeReaderValue = async (key: string, value: unknown) => {
  const db = await openReaderDb();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(READER_STORE_NAME, "readwrite");
    transaction.objectStore(READER_STORE_NAME).put(value, key);

    transaction.oncomplete = () => {
      resolve();
      db.close();
    };

    transaction.onerror = () => {
      reject(transaction.error);
      db.close();
    };
  });
};

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageText, setPageText] = useState("페이지: 0 / 0");
  const [gestureText, setGestureText] = useState("카메라를 준비하고 있어요");
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [savedScores, setSavedScores] = useState<SavedScore[]>([]);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isMotionGuideExpanded, setIsMotionGuideExpanded] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isFocusControlsVisible, setIsFocusControlsVisible] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [mouthHoldDurationMs, setMouthHoldDurationMs] = useState(MOUTH_HOLD_DURATION_MS);
  const [detectionStatus, setDetectionStatus] = useState("카메라를 준비하고 있어요");
  const [mouthProgress, setMouthProgress] = useState(0);
  const [isGestureActive, setIsGestureActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraPermission, setCameraPermission] = useState<"unknown" | "prompt" | "granted" | "denied">(
    "unknown"
  );
  const lastSwitchTimeRef = useRef<number>(0);
  const isRenderingRef = useRef(false);
  const pendingPageRef = useRef<number | null>(null);
  const cameraInstanceRef = useRef<MediaPipeCamera | null>(null);
  const faceMeshRef = useRef<MediaPipeFaceMesh | null>(null);
  const pdfDocRef = useRef<any>(null);
  const pageCountRef = useRef(0);
  const currentPageRef = useRef(1);
  const currentFileNameRef = useRef<string | null>(null);
  const currentPdfBlobRef = useRef<Blob | null>(null);
  const currentSavedScoreIdRef = useRef<string | null>(null);
  const gestureTextRef = useRef("카메라를 준비하고 있어요");
  const smoothedMouthRef = useRef<number | null>(null);
  const mouthStateRef = useRef<MouthDetectionState>({
    phase: "idle",
    startedAt: null,
    closedAt: null,
    stableFrames: 0,
  });
  const mouthHoldDurationRef = useRef(MOUTH_HOLD_DURATION_MS);
  const gestureFeedbackTimeoutRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const focusControlsTimeoutRef = useRef<number | null>(null);

  const loadPdfJs = async () => {
    if (window.pdfjsLib) {
      return window.pdfjsLib;
    }

    const pdfjsLib = await import("pdfjs-dist/build/pdf.mjs");
    window.pdfjsLib = pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return pdfjsLib;
  };

  const updateGestureText = (nextText: string) => {
    if (gestureTextRef.current === nextText) {
      return;
    }

    gestureTextRef.current = nextText;
    setGestureText(nextText);
  };

  const showTemporaryGestureText = (nextText: string) => {
    updateGestureText(nextText);

    if (gestureFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(gestureFeedbackTimeoutRef.current);
    }

    gestureFeedbackTimeoutRef.current = window.setTimeout(() => {
      if (gestureTextRef.current === nextText) {
        updateGestureText("입모양 감지 준비됨");
      }
      gestureFeedbackTimeoutRef.current = null;
    }, GESTURE_FEEDBACK_DURATION_MS);
  };

  const saveSessionState = async (overrides?: Partial<SessionState>) => {
    const sessionState: SessionState = {
      pdfBlob: currentPdfBlobRef.current,
      fileName: currentFileNameRef.current,
      currentPage: currentPageRef.current,
      savedScoreId: currentSavedScoreIdRef.current,
      ...overrides,
    };

    await writeReaderValue(SESSION_STATE_KEY, sessionState);
  };

  const saveScoresToDb = async (scores: SavedScore[]) => {
    setSavedScores(scores);
    await writeReaderValue(SAVED_SCORES_KEY, scores);
  };

  const loadPdfDocument = async ({
    blob,
    fileName,
    initialPage = 1,
    savedScoreId = null,
  }: {
    blob: Blob;
    fileName: string | null;
    initialPage?: number;
    savedScoreId?: string | null;
  }) => {
    await loadPdfJs();
    if (!window.pdfjsLib) {
      throw new Error("PDF 스크립트가 아직 준비되지 않았습니다.");
    }

    const data = await blob.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    const safeInitialPage = Math.max(1, Math.min(pdf.numPages, initialPage));

    setPdfDoc(pdf);
    setPageCount(pdf.numPages);
    setCurrentPage(safeInitialPage);
    setCurrentFileName(fileName);
    currentFileNameRef.current = fileName;
    pdfDocRef.current = pdf;
    pageCountRef.current = pdf.numPages;
    currentPageRef.current = safeInitialPage;
    currentPdfBlobRef.current = blob;
    currentSavedScoreIdRef.current = savedScoreId;

    await renderPage(pdf, safeInitialPage, pdf.numPages);
    await saveSessionState({
      pdfBlob: blob,
      fileName,
      currentPage: safeInitialPage,
      savedScoreId,
    });
  };

  useEffect(() => {
    let mounted = true;
    let permissionStatus: PermissionStatus | null = null;

    const syncPermissionState = async () => {
      if (!("permissions" in navigator) || !navigator.permissions?.query) {
        return;
      }

      try {
        permissionStatus = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (!mounted) {
          return;
        }

        setCameraPermission(permissionStatus.state);
        permissionStatus.onchange = () => {
          if (mounted) {
            setCameraPermission(permissionStatus!.state);
          }
        };
      } catch (error) {
        console.warn("camera permission query unsupported", error);
      }
    };

    void syncPermissionState();

    return () => {
      mounted = false;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const restoreReaderState = async () => {
      try {
        const storedMouthHoldDuration = Number(window.localStorage.getItem(MOUTH_HOLD_DURATION_STORAGE_KEY));
        if (MOUTH_HOLD_DURATION_OPTIONS_MS.includes(storedMouthHoldDuration)) {
          mouthHoldDurationRef.current = storedMouthHoldDuration;
          setMouthHoldDurationMs(storedMouthHoldDuration);
        }
        const [
          storedScores,
          sessionState,
        ] = await Promise.all([
          readReaderValue<SavedScore[]>(SAVED_SCORES_KEY),
          readReaderValue<SessionState>(SESSION_STATE_KEY),
        ]);

        if (cancelled) {
          return;
        }

        setSavedScores(storedScores ?? []);

        if (!sessionState?.pdfBlob) {
          return;
        }

        await loadPdfDocument({
          blob: sessionState.pdfBlob,
          fileName: sessionState.fileName,
          initialPage: sessionState.currentPage,
          savedScoreId: sessionState.savedScoreId,
        });
      } catch (error) {
        console.error("pdf restore error", error);
      }
    };

    void restoreReaderState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFocusMode(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (gestureFeedbackTimeoutRef.current !== null) window.clearTimeout(gestureFeedbackTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isFocusMode) {
      setIsFocusControlsVisible(false);
    }

    return () => {
      if (focusControlsTimeoutRef.current !== null) {
        window.clearTimeout(focusControlsTimeoutRef.current);
        focusControlsTimeoutRef.current = null;
      }
    };
  }, [isFocusMode]);

  useEffect(() => {
    let cancelled = false;

    let ownedCamera: MediaPipeCamera | null = null;
    let ownedFaceMesh: MediaPipeFaceMesh | null = null;
    const stopCamera = async () => {
      const camera = ownedCamera;
      if (camera) {
        await camera.stop();
        if (cameraInstanceRef.current === camera) cameraInstanceRef.current = null;
      }
      if (ownedFaceMesh) {
        await ownedFaceMesh.close();
        if (faceMeshRef.current === ownedFaceMesh) faceMeshRef.current = null;
        ownedFaceMesh = null;
      }
      smoothedMouthRef.current = null;
      mouthStateRef.current = { phase: "idle", startedAt: null, closedAt: null, stableFrames: 0 };
    };

    const initFaceMesh = async () => {
      if (!cameraEnabled) {
        await stopCamera();
        setDetectionStatus("입으로 넘기기를 잠시 멈췄어요");
        setMouthProgress(0);
        setIsGestureActive(false);
        return;
      }

      if (!videoRef.current) {
        return;
      }

      setDetectionStatus("카메라를 준비하고 있어요");
      setIsGestureActive(false);
      try {
        const [{ FaceMesh }, { Camera }] = await Promise.all([
          import("@mediapipe/face_mesh"),
          import("@mediapipe/camera_utils"),
        ]);

        if (cancelled || !videoRef.current) {
          return;
        }

        const faceMesh = new FaceMesh({
          locateFile: (file: string) => `/mediapipe/face_mesh/${file}`,
        });
        ownedFaceMesh = faceMesh;
        faceMeshRef.current = faceMesh;

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });

        faceMesh.onResults((results: Results) => {
          if (cancelled) return;
          if (!results.multiFaceLandmarks?.length) {
            smoothedMouthRef.current = null;
            mouthStateRef.current = { phase: "idle", startedAt: null, closedAt: null, stableFrames: 0 };
            updateDetectionFeedback(null);
            return;
          }
          const landmarks = results.multiFaceLandmarks[0];

          {
            const rawMouth = computeMouthOpenRatio(landmarks);
            const mouthRatio = getSmoothedMouthRatio(smoothedMouthRef, rawMouth);
            // Smoothing must not hide the brief close between two openings.
            const mouthClosed = rawMouth < MOUTH_CLOSE_RATIO_THRESHOLD;
            if (mouthClosed) smoothedMouthRef.current = rawMouth;
            const mouthNow = performance.now();
            const ms = mouthStateRef.current;
            const idleState: MouthDetectionState = { phase: "idle", startedAt: null, closedAt: null, stableFrames: 0 };
            if (ms.phase === "waiting-close") {
              if (mouthClosed) {
                mouthStateRef.current = idleState;
              }
            } else if (ms.phase === "first-closed") {
              if (ms.closedAt !== null && mouthNow - ms.closedAt > MOUTH_DOUBLE_TAP_WINDOW_MS) {
                mouthStateRef.current = { ...idleState, startedAt: rawMouth > MOUTH_OPEN_RATIO_THRESHOLD ? mouthNow : null, stableFrames: rawMouth > MOUTH_OPEN_RATIO_THRESHOLD ? 1 : 0 };
              } else if (rawMouth > MOUTH_OPEN_RATIO_THRESHOLD) {
                // The first open/close already confirms the gesture; do not
                // require the short second opening to survive smoothing or two frames.
                handleGesture("left");
                mouthStateRef.current = { phase: "waiting-close", startedAt: null, closedAt: null, stableFrames: 0 };
              }
            } else if (ms.phase === "open") {
              if (mouthClosed) {
                const openDuration = ms.startedAt !== null ? mouthNow - ms.startedAt : 0;
                if (openDuration >= MOUTH_MIN_OPEN_MS) {
                  mouthStateRef.current = { phase: "first-closed", startedAt: ms.startedAt, closedAt: mouthNow, stableFrames: 0 };
                } else {
                  mouthStateRef.current = idleState;
                }
              } else if (ms.startedAt !== null && mouthNow - ms.startedAt >= mouthHoldDurationRef.current) {
                handleGesture("right");
                mouthStateRef.current = { phase: "waiting-close", startedAt: null, closedAt: null, stableFrames: 0 };
              }
            } else {
              if (rawMouth > MOUTH_OPEN_RATIO_THRESHOLD) {
                const nextFrames = ms.stableFrames + 1;
                mouthStateRef.current = nextFrames >= MOUTH_STABLE_FRAME_TARGET && mouthRatio > MOUTH_OPEN_RATIO_THRESHOLD
                  ? { phase: "open", startedAt: mouthNow, closedAt: null, stableFrames: nextFrames }
                  : { ...ms, startedAt: ms.startedAt ?? mouthNow, stableFrames: nextFrames };
              } else if (mouthClosed && ms.stableFrames > 0 && ms.startedAt !== null
                && mouthNow - ms.startedAt >= MOUTH_MIN_OPEN_MS) {
                // Even one camera frame can represent a deliberate quick opening.
                mouthStateRef.current = { phase: "first-closed", startedAt: ms.startedAt, closedAt: mouthNow, stableFrames: 0 };
              } else if (ms.stableFrames > 0) {
                mouthStateRef.current = idleState;
              }
            }
          }
          updateDetectionFeedback(mouthStateRef.current);

        });

        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (!videoRef.current || cancelled) {
              return;
            }

            await faceMesh.send({ image: videoRef.current });
          },
          width: 640,
          height: 480,
          facingMode: "user",
        });

        ownedCamera = camera;
        cameraInstanceRef.current = camera;
        await camera.start();
        if (cancelled) {
          await camera.stop();
          return;
        }
        setCameraPermission("granted");
        setDetectionStatus("얼굴을 찾고 있어요");
      } catch (error) {
        console.error("mediapipe init error", error);
        if (cancelled) return;
        await stopCamera();
        if (!cancelled) {
          if (error instanceof DOMException && error.name === "NotAllowedError") {
            setCameraPermission("denied");
          }
          setCameraEnabled(false);
          const message = error instanceof DOMException && error.name === "NotAllowedError"
            ? "카메라 접근을 허용해 주세요"
            : "카메라를 연결하지 못했어요. 연결 상태를 확인해 주세요";
          setCameraError(message);
          setDetectionStatus(message);
          updateGestureText(message);
        }
      }
    };

    void initFaceMesh();

    return () => {
      cancelled = true;
      void stopCamera();
    };
  }, [cameraEnabled]);

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await loadPdfDocument({
        blob: file,
        fileName: file.name,
        initialPage: 1,
        savedScoreId: null,
      });
      const saved = await persistCurrentPdf();
      updateGestureText(saved ? "PDF를 불러오고 자동 저장했습니다." : "PDF를 불러왔습니다.");
    } catch (error) {
      updateGestureText("PDF 라이브러리 로드 실패");
      console.error("pdfjs load error", error);
    } finally {
      event.target.value = "";
    }
  };

  const renderPage = async (pdf: any, pageNumber: number, totalPages: number) => {
    if (!canvasRef.current) return;
    if (isRenderingRef.current) {
      pendingPageRef.current = pageNumber;
      return;
    }

    isRenderingRef.current = true;

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      isRenderingRef.current = false;
      return;
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;
    isRenderingRef.current = false;

    setPageText(`페이지: ${pageNumber} / ${totalPages}`);

    if (pendingPageRef.current !== null) {
      const next = pendingPageRef.current;
      pendingPageRef.current = null;
      renderPage(pdf, next, totalPages);
    }
  };

  const queuePage = (pageNumber: number) => {
    const pdf = pdfDocRef.current;
    const totalPages = pageCountRef.current;
    const activePage = currentPageRef.current;

    if (!pdf || totalPages === 0) return;

    const safePage = Math.max(1, Math.min(totalPages, pageNumber));
    if (safePage === activePage) return;

    currentPageRef.current = safePage;
    setCurrentPage(safePage);
    void renderPage(pdf, safePage, totalPages);
    void saveSessionState({ currentPage: safePage });

    if (currentSavedScoreIdRef.current) {
      const nextScores = savedScores.map((score) =>
        score.id === currentSavedScoreIdRef.current ? { ...score, currentPage: safePage, updatedAt: Date.now() } : score
      );
      void saveScoresToDb(nextScores);
    }
  };

  const handlePageSwipeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    touchStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePageSwipeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!start || event.pointerId !== start.pointerId) {
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < TOUCH_SWIPE_MIN_DISTANCE_PX || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }

    if (pageCountRef.current === 0) {
      return;
    }

    const targetPage = currentPageRef.current + (deltaX < 0 ? 1 : -1);
    const safeTargetPage = Math.max(1, Math.min(pageCountRef.current, targetPage));
    if (safeTargetPage === currentPageRef.current) {
      showTemporaryGestureText(deltaX < 0 ? "마지막 페이지" : "첫 페이지");
      return;
    }

    queuePage(safeTargetPage);
    showTemporaryGestureText(deltaX < 0 ? "다음 페이지" : "이전 페이지");
  };

  const persistCurrentPdf = async () => {
    if (!currentPdfBlobRef.current) {
      return false;
    }

    const nextScore: SavedScore = {
      id: currentSavedScoreIdRef.current ?? crypto.randomUUID(),
      name: currentFileNameRef.current ?? `악보 ${savedScores.length + 1}`,
      pdfBlob: currentPdfBlobRef.current,
      currentPage: currentPageRef.current,
      updatedAt: Date.now(),
    };

    const nextScores = currentSavedScoreIdRef.current
      ? savedScores.map((score) => (score.id === nextScore.id ? nextScore : score))
      : [nextScore, ...savedScores];

    currentSavedScoreIdRef.current = nextScore.id;
    await saveScoresToDb(nextScores);
    await saveSessionState({ savedScoreId: nextScore.id });
    return true;
  };

  const openSavedScore = async (score: SavedScore) => {
    try {
      await loadPdfDocument({
        blob: score.pdfBlob,
        fileName: score.name,
        initialPage: score.currentPage,
        savedScoreId: score.id,
      });

      const nextScores = savedScores.map((item) =>
        item.id === score.id ? { ...item, updatedAt: Date.now() } : item
      );
      await saveScoresToDb(nextScores);
      updateGestureText("저장된 악보를 불러왔습니다.");
      setIsLibraryOpen(false);
    } catch (error) {
      console.error("saved score open error", error);
      updateGestureText("저장된 악보를 불러오지 못했습니다.");
    }
  };

  const deleteSavedScore = async (scoreId: string) => {
    const nextScores = savedScores.filter((score) => score.id !== scoreId);
    await saveScoresToDb(nextScores);

    if (currentSavedScoreIdRef.current === scoreId) {
      currentSavedScoreIdRef.current = null;
      await saveSessionState({ savedScoreId: null });
    }

    updateGestureText("저장된 악보를 삭제했습니다.");
  };

  const handleCameraAction = () => {
    setCameraError(null);
    setCameraEnabled((enabled) => !enabled);
  };

  const updateDetectionFeedback = (state: MouthDetectionState | null) => {
    setIsGestureActive(state !== null && (state.phase !== "idle" || state.stableFrames > 0));
    if (!state) {
      setDetectionStatus("얼굴이 카메라에 보이도록 해주세요");
      setMouthProgress(0);
      return;
    }
    setMouthProgress(state.phase === "open" && state.startedAt !== null
      ? Math.min(100, Math.round((performance.now() - state.startedAt) / mouthHoldDurationRef.current * 100))
      : 0);
    setDetectionStatus(state.phase === "waiting-close" ? "입을 닫으면 다시 넘길 수 있어요"
      : state.phase === "open" ? "조금만 유지하세요 · 다음 페이지 →"
      : state.phase === "first-closed" ? "바로 다시 벌리면 이전 페이지로 이동해요"
      : "준비됐어요 · 입을 벌리면 다음 페이지");
  };

  const revealFocusControls = () => {
    if (!isFocusMode) {
      return;
    }

    setIsFocusControlsVisible(true);

    if (focusControlsTimeoutRef.current !== null) {
      window.clearTimeout(focusControlsTimeoutRef.current);
    }

    focusControlsTimeoutRef.current = window.setTimeout(() => {
      setIsFocusControlsVisible(false);
      focusControlsTimeoutRef.current = null;
    }, 2200);
  };

  const handleGesture = (direction: "left" | "right") => {
    const now = performance.now();
    if (now - lastSwitchTimeRef.current < PAGE_TURN_COOLDOWN_MS) {
      return false;
    }

    const totalPages = pageCountRef.current;
    const currentPage = currentPageRef.current;
    if (totalPages === 0) {
      updateGestureText("PDF를 먼저 불러와 주세요");
      return false;
    }

    if (direction === "right") {
      if (currentPage >= totalPages) {
        showTemporaryGestureText("마지막 페이지");
        return false;
      } else {
        queuePage(currentPage + 1);
        showTemporaryGestureText("다음 페이지");
        lastSwitchTimeRef.current = now;
        return true;
      }
    } else {
      if (currentPage <= 1) {
        showTemporaryGestureText("첫 페이지");
        return false;
      } else {
        queuePage(currentPage - 1);
        showTemporaryGestureText("이전 페이지");
        lastSwitchTimeRef.current = now;
        return true;
      }
    }
  };

  const computeMouthOpenRatio = (landmarks: NormalizedLandmark[]) => {
    const leftCorner = landmarks[61];
    const rightCorner = landmarks[291];
    const width = Math.hypot(rightCorner.x - leftCorner.x, rightCorner.y - leftCorner.y);
    if (width === 0) return 0;
    const upper = landmarks[13];
    const lower = landmarks[14];
    return Math.hypot(upper.x - lower.x, upper.y - lower.y) / width;
  };

  const getSmoothedMouthRatio = (targetRef: React.MutableRefObject<number | null>, nextValue: number) => {
    if (targetRef.current === null) {
      targetRef.current = nextValue;
      return nextValue;
    }

    targetRef.current =
      targetRef.current * (1 - MOUTH_RATIO_SMOOTHING_ALPHA) + nextValue * MOUTH_RATIO_SMOOTHING_ALPHA;
    return targetRef.current;
  };

  const canGoPrevious = currentPage > 1;
  const canGoNext = pageCount > 0 && currentPage < pageCount;
  const hasLoadedPdf = pdfDoc !== null;
  const cameraPermissionOn = cameraPermission === "granted";
  const isCameraReady = cameraEnabled && cameraPermissionOn;
  const cameraButtonText = cameraEnabled ? "잠시 멈추기"
    : cameraPermission === "denied" ? "카메라 허용하기" : "다시 시작";
  const viewerTitle = currentFileName ?? "불러온 악보";
  const gestureOverlayText = ["다음 페이지", "이전 페이지", "마지막 페이지", "첫 페이지"].includes(gestureText)
    ? gestureText : null;
  const uploadAction = (text: string) => (
    <label className="file-label primary-upload-action">
      <strong>{text}</strong>
      <input type="file" accept="application/pdf" onChange={onFileChange} />
    </label>
  );

  const detectionFeedback = (
    <div className="detection-feedback">
      <p role="status">{cameraError ?? (isFocusMode && gestureOverlayText ? gestureOverlayText : detectionStatus)}</p>
      <div className="hold-progress" role="progressbar" aria-label="다음 페이지 동작 진행" aria-valuemin={0} aria-valuemax={100} aria-valuenow={mouthProgress}>
        <div style={{ width: `${mouthProgress}%` }} />
      </div>
    </div>
  );

  return (
    <main className={`app-shell ${isFocusMode ? "is-focus-mode" : ""} ${isFocusControlsVisible ? "show-focus-controls" : ""}`}>
      <header className="topbar">
        <div className="brand-block"><h1>입으로 넘기는 악보</h1><p>손은 연주에, 페이지는 입으로.</p></div>
        <div className="topbar-actions">
          {hasLoadedPdf ? uploadAction("악보 변경") : null}
          <button type="button" className="secondary-button" onClick={() => setIsLibraryOpen((prev) => !prev)} aria-expanded={isLibraryOpen} aria-controls="saved-library">최근 악보</button>
        </div>
      </header>

      {cameraPermission === "denied" ? <p className="permission-help">입으로 넘기려면 카메라 권한이 필요해요. 주소창의 사이트 설정에서 카메라를 허용한 뒤 ‘카메라 허용하기’를 눌러주세요.</p> : null}
      <section className="motion-bar" aria-label="입으로 페이지 넘기기">
        <div className="motion-bar-copy"><span className={`status-dot ${isCameraReady ? "is-ready" : ""}`} aria-hidden="true" /><strong>입으로 페이지 넘기기</strong><span>{cameraEnabled ? "자동으로 시작됩니다" : cameraError ? "카메라 확인 필요" : "잠시 멈춤"}</span></div>
        <button type="button" className="camera-toggle" onClick={handleCameraAction} aria-pressed={cameraEnabled}>{cameraButtonText}</button>
      </section>

      {isLibraryOpen ? (
        <section className="saved-library" id="saved-library" aria-label="최근 악보">
          <h2>최근 악보</h2>
          {savedScores.length === 0 ? <p className="library-empty">악보를 열면 여기에 자동으로 저장돼요.</p> : (
            <ul className="saved-score-list">{savedScores.map((score) => (
              <li key={score.id} className="saved-score-item">
                <button type="button" className="saved-score-open" onClick={() => { setIsLibraryOpen(false); void openSavedScore(score); }}><strong>{score.name}</strong><span>{score.currentPage}페이지부터 이어보기</span></button>
                <button type="button" className="saved-score-delete" aria-label={`${score.name} 삭제`} onClick={() => void deleteSavedScore(score.id)}>삭제</button>
              </li>
            ))}</ul>
          )}
        </section>
      ) : null}

      <section className="workspace-grid">
        <div className="viewer-card" onMouseMove={isFocusMode ? revealFocusControls : undefined} onTouchStart={isFocusMode ? revealFocusControls : undefined}>
          {isFocusMode ? <button type="button" className="focus-close-button" onClick={() => setIsFocusMode(false)} aria-label="집중 모드 닫기" title="집중 모드 닫기 (Esc)"><span aria-hidden="true">×</span></button> : null}
          {isFocusMode && cameraEnabled && !cameraError && isGestureActive ? <div className="focus-detection-feedback">{detectionFeedback}</div> : null}
          {gestureOverlayText && !isFocusMode ? <div className="gesture-overlay-text" role="status">{gestureOverlayText}</div> : null}
          <div className="viewer-toolbar">
            <div className="viewer-heading"><h2>{hasLoadedPdf ? viewerTitle : "악보를 열고 바로 시작하세요"}</h2></div>
            {hasLoadedPdf ? <div className="page-buttons"><button type="button" onClick={() => setIsFocusMode((prev) => !prev)}>{isFocusMode ? "집중 모드 종료" : "집중 모드"}</button></div> : null}
          </div>
          <div className="pdf-viewer" onPointerDown={handlePageSwipeStart} onPointerUp={handlePageSwipeEnd} onPointerCancel={() => { touchStartRef.current = null; }}>
            <canvas ref={canvasRef} hidden={!hasLoadedPdf} />
            {!hasLoadedPdf ? <div className="empty-viewer">
              <div className="empty-viewer-content"><span className="empty-eyebrow">HANDS FREE PDF READER</span><h2>손을 쓰지 않고<br />악보를 넘겨보세요</h2><p>입을 벌리고 잠깐 유지하면 다음 페이지로 넘어갑니다.</p>{uploadAction("PDF 악보 열기")}<span className="empty-note">카메라 접근을 허용하면 입 움직임을 감지해요.</span></div>
            </div> : null}
          </div>
          {!isFocusMode ? <footer className="reader-footer">
            {hasLoadedPdf ? <nav className="page-navigation" aria-label="페이지 이동"><button type="button" onClick={() => queuePage(currentPage - 1)} disabled={!canGoPrevious}>← 이전</button><span aria-live="polite"><strong>{currentPage}</strong> / {pageCount}</span><button type="button" onClick={() => queuePage(currentPage + 1)} disabled={!canGoNext}>다음 →</button></nav> : null}
            {detectionFeedback}
          </footer> : null}
        </div>
      </section>

      <section className="gesture-guide" aria-label="입으로 넘기는 방법">
        <div className="gesture-tip primary-tip"><span aria-hidden="true">→</span><div><strong>다음 페이지</strong><p>입을 벌리고 잠깐 유지 <span>· {(mouthHoldDurationMs / 1000).toFixed(1)}초</span></p></div></div>
        <div className="gesture-tip"><span aria-hidden="true">←</span><div><strong>이전 페이지</strong><p>입을 짧게 두 번 벌리기</p></div></div>
        <button type="button" className="guide-toggle" onClick={() => setIsMotionGuideExpanded((prev) => !prev)} aria-expanded={isMotionGuideExpanded} aria-controls="gesture-details">{isMotionGuideExpanded ? "도움말 닫기" : "자세한 사용법"}</button>
        {isMotionGuideExpanded ? <div className="gesture-details" id="gesture-details">          <label className="mouth-duration-setting">
            <span>다음 페이지 넘김 시간</span>
            <span className="mouth-duration-control">
              <select
                value={mouthHoldDurationMs}
                onChange={(event) => {
                  const nextDuration = Number(event.target.value);
                  mouthHoldDurationRef.current = nextDuration;
                  setMouthHoldDurationMs(nextDuration);
                  window.localStorage.setItem(MOUTH_HOLD_DURATION_STORAGE_KEY, String(nextDuration));
                }}
              >
                {MOUTH_HOLD_DURATION_OPTIONS_MS.map((duration) => (
                  <option key={duration} value={duration}>
                    {(duration / 1000).toFixed(1)}초
                  </option>
                ))}
              </select>
            </span>
            <small>{(mouthHoldDurationMs / 1000).toFixed(1)}초 동안 입을 벌리면 다음 페이지로 넘어갑니다.</small>
          </label>
<p>페이지가 넘어가면 입을 닫아주세요. 이전 페이지로 가려면 입을 짧게 벌렸다 닫고 바로 다시 벌리세요. 이동 후에는 1.2초 뒤에 다시 넘길 수 있어요. 얼굴이 잘 보이지 않으면 카메라 위치와 주변 밝기를 확인해 주세요. PDF 화면을 왼쪽으로 밀면 다음 페이지, 오른쪽으로 밀면 이전 페이지로 이동해요.</p></div> : null}
      </section>
      <p className="sr-only" role="status">{gestureText}</p>
      <video ref={videoRef} autoPlay muted playsInline className="camera-feed-hidden" />
    </main>
  );
}
