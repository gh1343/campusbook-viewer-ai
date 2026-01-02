export const askAiAction = (
  selectionText: string,
  triggerSmartExplain: (text: string) => void,
  hideSelection: () => void
): boolean => {
  if (!selectionText.trim()) {
    hideSelection();
    return false;
  }
  triggerSmartExplain(selectionText);
  hideSelection();
  return true;
};
