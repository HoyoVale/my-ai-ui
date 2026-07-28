export function ownsResponseWindow(
  currentWindow,
  candidateWindow
) {
  return Boolean(
    currentWindow &&
    currentWindow === candidateWindow
  );
}
