export type Language = "ko" | "en";
export const LANGUAGE_STORAGE_KEY = "reader-language";

export const resolveLanguage = (saved: string | null, browserLanguage: string): Language => {
  if (saved === "ko" || saved === "en") return saved;
  return /^ko(?:-|$)/i.test(browserLanguage) ? "ko" : "en";
};

export const readLanguage = (browserLanguage: string, storage: Pick<Storage, "getItem">): Language => {
  try {
    return resolveLanguage(storage.getItem(LANGUAGE_STORAGE_KEY), browserLanguage);
  } catch {
    return resolveLanguage(null, browserLanguage);
  }
};

export const saveLanguage = (language: Language, storage: Pick<Storage, "setItem">): void => {
  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // A blocked or full storage area must not prevent switching this session.
  }
};

export const english: Record<string, string> = {
  "언어": "Language",
  "페이지: 0 / 0": "Page: 0 / 0",
  "카메라를 준비하고 있어요": "Starting the camera…",
  "입모양 감지 준비됨": "Mouth detection ready",
  "자동 저장에 실패했어요. 브라우저 저장 공간을 확인한 뒤 다시 저장해 주세요.": "Couldn’t save automatically. Check your browser storage, then try saving again.",
  "입으로 넘기기를 잠시 멈췄어요": "Hands-free page turning paused",
  "얼굴을 찾고 있어요": "Looking for your face…",
  "카메라 접근을 허용해 주세요": "Please allow camera access",
  "카메라를 연결하지 못했어요. 연결 상태를 확인해 주세요": "Couldn’t connect to your camera. Check the connection and try again.",
  "PDF를 불러오고 자동 저장했습니다.": "PDF opened and saved automatically.",
  "PDF를 불러왔지만 자동 저장하지 못했습니다.": "PDF opened, but couldn’t be saved automatically.",
  "PDF를 열지 못했어요. 파일을 확인하고 다시 시도해 주세요.": "Couldn’t open this PDF. Check the file and try again.",
  "악보를 표시하지 못했어요. 다시 시도해 주세요.": "Couldn’t display this page. Please try again.",
  "마지막 페이지": "Last page",
  "첫 페이지": "First page",
  "다음 페이지": "Next page",
  "이전 페이지": "Previous page",
  "악보 {number}": "Score {number}",
  "저장된 악보를 불러왔습니다.": "Saved score opened.",
  "저장된 악보를 불러오지 못했습니다.": "Couldn’t open the saved score.",
  "저장된 악보를 삭제했습니다.": "Saved score deleted.",
  "목록에서 삭제했지만 저장하지 못했습니다. 다시 저장해 주세요.": "Removed from the list, but couldn’t save the change. Please save again.",
  "악보와 현재 페이지를 다시 저장했습니다.": "Your scores and current page have been saved.",
  "얼굴이 카메라에 보이도록 해주세요": "Make sure your face is visible to the camera",
  "입을 닫으면 다시 넘길 수 있어요": "Close your mouth before turning another page",
  "조금만 유지하세요 · 다음 페이지 →": "Hold a little longer · Next page →",
  "지금 한 번 더 벌리세요 · 이전 페이지 ←": "Open once more now · Previous page ←",
  "준비됐어요 · 입을 벌리면 다음 페이지": "Ready · Open your mouth to turn the page",
  "PDF를 먼저 불러와 주세요": "Open a PDF first",
  "다음 페이지 동작이 인식됐어요!": "Next-page gesture recognized!",
  "이전 페이지 동작이 인식됐어요!": "Previous-page gesture recognized!",
  "길게 벌려서 다음 페이지 동작으로 인식됐어요. 첫 번째 벌림을 더 짧게 해보세요.": "That was a next-page gesture. Make the first opening shorter, then close and open again.",
  "두 번 벌려서 이전 페이지 동작으로 인식됐어요. 다음 페이지는 입을 벌린 채 유지해주세요.": "That was a previous-page gesture. To go forward, keep your mouth open.",
  "두 번째 벌림을 기다리다 끝났어요. 닫은 뒤 바로 한 번 더 벌려보세요.": "The second opening didn’t arrive in time. Close, then open again right away.",
  "먼저 입을 닫고 준비해주세요.": "Close your mouth to get ready.",
  "얼굴이 카메라에 보이도록 해주세요.": "Make sure your face is visible to the camera.",
  "그대로 조금만 유지하세요!": "Keep holding it open!",
  "입을 벌리고 잠깐 유지해보세요.": "Open your mouth and hold it briefly.",
  "지금 한 번 더 벌리세요!": "Open once more now!",
  "입을 닫고 바로 다시 벌려보세요.": "Close your mouth, then open it again right away.",
  "입을 짧게 벌렸다 닫고, 바로 한 번 더 벌려보세요.": "Open briefly, close, then open once more right away.",
  "잠시 멈추기": "Pause",
  "카메라 허용하기": "Enable camera",
  "다시 시작": "Resume",
  "불러온 악보": "Your score",
  "유지하면 다음 페이지 →": "Hold to go forward →",
  "한 번 더 벌리면 이전 ←": "Open again to go back ←",
  "입을 닫아주세요": "Close your mouth",
  "입을 벌려주세요": "Open your mouth",
  "다음 페이지 동작 진행": "Next-page gesture progress",
  "입으로 넘기는 악보": "Hands-Free Score Reader",
  "손은 연주에, 페이지는 입으로.": "Keep your hands on the music.",
  "사용법": "How to use",
  "악보 변경": "Change PDF",
  "최근 악보": "Recent scores",
  "다시 저장": "Save again",
  "입으로 넘기려면 카메라 권한이 필요해요. 주소창의 사이트 설정에서 카메라를 허용한 뒤 ‘카메라 허용하기’를 눌러주세요.": "Camera access is needed for hands-free page turning. Allow camera access in your browser’s site settings, then select ‘Enable camera’.",
  "입으로 페이지 넘기기": "Hands-free page turning",
  "자동으로 시작됩니다": "Starts automatically",
  "카메라 확인 필요": "Check camera",
  "잠시 멈춤": "Paused",
  "악보를 열면 여기에 자동으로 저장돼요.": "Scores you open are saved here automatically.",
  "{page}페이지부터 이어보기": "Resume from page {page}",
  "{name} 삭제": "Delete {name}",
  "삭제": "Delete",
  "전체 보기 닫기": "Exit full view",
  "전체 보기 닫기 (Esc)": "Exit full view (Esc)",
  "악보를 열고 바로 시작하세요": "Open a score to get started",
  "전체 보기 종료": "Exit full view",
  "전체 보기": "Full view",
  "다시 시도": "Try again",
  "손을 쓰지 않고": "Turn sheet music pages",
  "악보를 넘겨보세요": "hands-free",
  "입을 벌리고 잠깐 유지하면 다음 페이지로 넘어갑니다.": "Open your mouth and hold briefly to turn to the next page.",
  "PDF 악보 열기": "Open a PDF score",
  "카메라 접근을 허용하면 입 움직임을 감지해요.": "Allow camera access to detect your mouth movements.",
  "페이지 이동": "Page navigation",
  "← 이전": "← Previous",
  "다음 →": "Next →",
  "사용법 닫기": "Close instructions",
  "배울 동작 선택": "Choose a gesture",
  "다음 페이지 →": "Next page →",
  "← 이전 페이지": "← Previous page",
  "입을 벌린 채 잠깐 유지하세요": "Open your mouth and hold briefly",
  "짧게 벌렸다 닫고, 한 번 더": "Open, close, then open once more",
  "{seconds}초 유지": "Hold for {seconds} s",
  "하면 다음 페이지로 넘어가요.": " to turn to the next page.",
  "넘어간 뒤에는 입을 닫아주세요.": "Close your mouth after the page turns.",
  "첫 번째는 짧게 벌렸다 닫고, 곧바로 다시 벌리세요.": "Open briefly, close, then open again right away.",
  "두 번째로 벌릴 때": "On the second opening",
  "이전 페이지로 넘어가요.": "you’ll turn back a page.",
  "벌리기": "Open",
  "잠깐 유지": "Hold briefly",
  "닫기": "Close",
  "짧게 벌리기": "Open briefly",
  "다시 벌리기": "Open again",
  "입을 벌리고 유지할 시간": "How long to hold",
  "{seconds}초": "{seconds} s",
  "첫 번째 벌림을 길게 유지하면 다음 페이지로 인식돼요. 위 입 모양의 리듬을 참고해주세요.": "Holding the first opening too long turns the page forward. Follow the rhythm shown above.",
  "동작 연습 시작": "Start gesture practice",
  "내 동작 확인하기": "Try your gesture",
  "연습 중에는 실제 악보가 넘어가지 않아요.": "Your score stays on the same page during practice.",
  "직접 해보기": "Try it yourself",
  "동작 연습": "Gesture practice",
  "잘했어요!": "You’ve got it!",
  "지금은 연습 중이에요": "Practice mode",
  "카메라를 켜면 내 동작을 확인할 수 있어요.": "Turn on the camera to try your gesture.",
  "다음 페이지 동작 연습 진행": "Next-page practice progress",
  "카메라 켜고 연습": "Enable camera to practice",
  "다시 해보기": "Try again",
  "이전 페이지 사용법 보기": "Learn the previous-page gesture",
  "연습 마치기": "Finish practice",
  "입모양과 버튼으로 페이지를 넘길 수 있는 핸즈프리 PDF 리더": "A hands-free PDF score reader. Turn pages with mouth gestures or on-screen controls.",
};

export const translate = (language: Language, text: string, values: Record<string, string | number> = {}): string => {
  const message = language === "en" && Object.prototype.hasOwnProperty.call(english, text) ? english[text] : text;
  return message.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder);
};
